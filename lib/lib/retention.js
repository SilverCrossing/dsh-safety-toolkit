/**
 * Backup retention: scan, prune, and capacity decisions.
 *
 * Order of precedence, strongest first:
 *   protected (`.keep`)  >  protection window (MIN_AGE)  >  keep-per-file  >  max age  >  max bytes
 *
 * Consequences that matter:
 *  - A protected snapshot is never removed automatically, even when the quota
 *    is exhausted. If protected snapshots alone exceed the quota, pruning stops
 *    and reports `overLimit` instead of deleting them.
 *  - Pruning runs before a write, and only deletes when a limit is actually
 *    exceeded, so history is not silently eaten every five minutes.
 *  - Every failure is swallowed: maintenance must never break an edit.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { formatBytes, requireSpace } from './disk.js';
import { parseSnapshotName } from './layout.js';
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
function positiveInt(raw, fallback) {
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function loadPolicy(env = process.env) {
    return {
        maxBytes: positiveInt(env.DSH_SAFETY_BACKUP_MAX_BYTES, GiB),
        maxAgeMs: positiveInt(env.DSH_SAFETY_BACKUP_MAX_AGE_DAYS, 14) * 24 * 60 * 60 * 1000,
        minAgeMs: positiveInt(env.DSH_SAFETY_BACKUP_MIN_AGE_HOURS, 24) * 60 * 60 * 1000,
        keepPerFile: positiveInt(env.DSH_SAFETY_BACKUP_KEEP_PER_FILE, 10),
        throttleMs: positiveInt(env.DSH_SAFETY_BACKUP_THROTTLE_MINUTES, 5) * 60 * 1000,
        minFreeBytes: positiveInt(env.DSH_SAFETY_BACKUP_MIN_FREE_MB, 100) * MiB,
    };
}
async function walk(directory, out = []) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory())
            await walk(full, out);
        else if (entry.isFile())
            out.push(full);
    }
    return out;
}
async function sizeOf(absolute) {
    try {
        return (await stat(absolute)).size;
    }
    catch {
        return 0;
    }
}
/** Every snapshot under `root`, without stat (size is 0 until measured). */
export async function scanSnapshots(root) {
    const files = await walk(root);
    const entries = [];
    for (const absolute of files) {
        const name = basename(absolute);
        const parsed = parseSnapshotName(name);
        if (parsed === undefined)
            continue;
        entries.push({
            absolute,
            directory: basename(dirname(absolute)),
            name,
            kind: parsed.kind,
            stamp: parsed.stamp,
            time: parsed.time,
            absent: parsed.absent,
            protected: parsed.protected,
            size: 0,
        });
    }
    return entries;
}
let lastPruneAt = 0;
/** Test hook: forget the throttle window. */
export function resetPruneThrottle() {
    lastPruneAt = 0;
}
/**
 * Enforce retention limits.
 * @param root - backup root.
 * @param policy - limits.
 * @param options.bypassThrottle - evaluate immediately (used in degraded state).
 */
export async function prune(root, policy, options = {}) {
    const now = Date.now();
    if (options.bypassThrottle !== true && now - lastPruneAt < policy.throttleMs) {
        return { ran: false, removed: 0, bytesFreed: 0, totalBytes: -1, protectedBytes: 0, protectedCount: 0, overLimit: false };
    }
    lastPruneAt = now;
    try {
        const snapshots = await scanSnapshots(root);
        if (snapshots.length === 0) {
            return { ran: true, removed: 0, bytesFreed: 0, totalBytes: 0, protectedBytes: 0, protectedCount: 0, overLimit: false };
        }
        const removable = (entry) => !entry.protected && now - entry.time > policy.minAgeMs;
        const removals = new Set();
        // 1. Keep-per-file: only snapshots past the protection window compete.
        const groups = new Map();
        for (const entry of snapshots) {
            const list = groups.get(entry.directory);
            if (list === undefined)
                groups.set(entry.directory, [entry]);
            else
                list.push(entry);
        }
        if (policy.keepPerFile > 0) {
            for (const group of groups.values()) {
                const eligible = group.filter(removable).sort((a, b) => b.time - a.time);
                for (const entry of eligible.slice(policy.keepPerFile))
                    removals.add(entry.absolute);
            }
        }
        // 2. Max age.
        if (policy.maxAgeMs > 0) {
            for (const entry of snapshots) {
                if (removable(entry) && now - entry.time > policy.maxAgeMs)
                    removals.add(entry.absolute);
            }
        }
        // 3. Measure survivors (only these need stat).
        let totalBytes = 0;
        let protectedBytes = 0;
        let protectedCount = 0;
        const survivors = [];
        for (const entry of snapshots) {
            if (entry.protected)
                protectedCount += 1;
            if (removals.has(entry.absolute))
                continue;
            const size = await sizeOf(entry.absolute);
            const measured = { ...entry, size };
            survivors.push(measured);
            totalBytes += size;
            if (entry.protected)
                protectedBytes += size;
        }
        // 4. Max bytes: oldest first, never touching protected entries.
        let overLimit = false;
        if (policy.maxBytes > 0 && totalBytes > policy.maxBytes) {
            const candidates = survivors
                .filter(entry => !entry.protected)
                .sort((a, b) => a.time - b.time);
            for (const entry of candidates) {
                if (totalBytes <= policy.maxBytes)
                    break;
                removals.add(entry.absolute);
                totalBytes -= entry.size;
            }
            overLimit = totalBytes > policy.maxBytes;
        }
        // 5. Delete. `survivors` holds the entries that stay, so the removal set
        // is resolved against the full snapshot list instead.
        let removed = 0;
        let bytesFreed = 0;
        for (const entry of snapshots) {
            if (!removals.has(entry.absolute))
                continue;
            try {
                const size = await sizeOf(entry.absolute);
                await unlink(entry.absolute);
                removed += 1;
                bytesFreed += size;
            }
            catch {
                // A snapshot that vanished or is locked stays as it is.
            }
        }
        return { ran: true, removed, bytesFreed, totalBytes, protectedBytes, protectedCount, overLimit };
    }
    catch {
        return { ran: true, removed: 0, bytesFreed: 0, totalBytes: -1, protectedBytes: 0, protectedCount: 0, overLimit: false };
    }
}
let lastWarnAt = 0;
const WARN_INTERVAL_MS = 5 * 60 * 1000;
/** Warn at most once per five minutes, so a degraded state cannot spam the log. */
export function warnThrottled(message) {
    if (Date.now() - lastWarnAt < WARN_INTERVAL_MS)
        return;
    lastWarnAt = Date.now();
    console.warn(`[safety-toolkit] ${message}`);
}
/** Test hook: forget the warning window. */
export function resetWarnThrottle() {
    lastWarnAt = 0;
}
/**
 * Decide whether one more snapshot of `requiredBytes` may be written.
 *
 * Runs before the write so a snapshot always exists before a file changes, and
 * never deletes anything unless a limit is actually exceeded.
 */
export async function ensureCapacity(root, requiredBytes, policy, options = {}) {
    const space = await requireSpace(root, policy.minFreeBytes);
    if (!space.ok) {
        const free = space.freeBytes ?? 0;
        const detail = `备份目录所在分区只剩 ${formatBytes(free)}，低于安全线 ${formatBytes(policy.minFreeBytes)}`;
        warnThrottled(`${detail}，已暂停需要生成快照的写操作`);
        return {
            ok: false,
            reason: 'disk',
            detail,
            advice: '清理磁盘空间，或用 DSH_SAFETY_BACKUP_DIR 把备份目录换到空间充足的分区。',
            totalBytes: 0,
            protectedBytes: 0,
        };
    }
    // Degraded writes always re-evaluate; the throttle would otherwise keep a
    // user locked out for minutes after they cleaned up manually.
    const result = await prune(root, policy, { bypassThrottle: options.degraded === true });
    const total = result.totalBytes >= 0 ? result.totalBytes : await totalSizeOf(root);
    if (policy.maxBytes > 0 && total + requiredBytes > policy.maxBytes) {
        const detail = `备份总量 ${formatBytes(total)} 加上本次快照 ${formatBytes(requiredBytes)} 会超过上限 ${formatBytes(policy.maxBytes)}`;
        const protectedNote = result.protectedCount > 0
            ? `其中受保护（.keep）快照 ${result.protectedCount} 个、占用 ${formatBytes(result.protectedBytes)}，不会自动删除。`
            : '';
        warnThrottled(`${detail}；${protectedNote}已暂停需要生成快照的写操作`);
        return {
            ok: false,
            reason: 'quota',
            detail,
            advice: [
                protectedNote,
                '可选处理：用 safe_backups 的 unpin 取消某些快照的保护后重试；手动删除不需要的历史快照；或调大 DSH_SAFETY_BACKUP_MAX_BYTES。',
            ].filter(part => part !== '').join(' '),
            totalBytes: total,
            protectedBytes: result.protectedBytes,
        };
    }
    return { ok: true, totalBytes: total, protectedBytes: result.protectedBytes };
}
async function totalSizeOf(root) {
    const entries = await scanSnapshots(root);
    let total = 0;
    for (const entry of entries)
        total += await sizeOf(entry.absolute);
    return total;
}
