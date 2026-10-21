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
import { type BackupKind } from './layout.js';
export interface RetentionPolicy {
    /** Per-root total size cap; 0 disables the check. */
    readonly maxBytes: number;
    /** Age beyond which snapshots are removed; 0 disables the check. */
    readonly maxAgeMs: number;
    /** Snapshots younger than this are never removed automatically. */
    readonly minAgeMs: number;
    /** Snapshots kept per source file. */
    readonly keepPerFile: number;
    /** Minimum gap between prune runs while healthy. */
    readonly throttleMs: number;
    /** Free space required on the backup partition before writing. */
    readonly minFreeBytes: number;
}
export declare function loadPolicy(env?: NodeJS.ProcessEnv): RetentionPolicy;
export interface SnapshotEntry {
    readonly absolute: string;
    readonly directory: string;
    readonly name: string;
    readonly kind: BackupKind;
    readonly stamp: string;
    readonly time: number;
    readonly absent: boolean;
    readonly protected: boolean;
    readonly size: number;
}
/** Every snapshot under `root`, without stat (size is 0 until measured). */
export declare function scanSnapshots(root: string): Promise<SnapshotEntry[]>;
export interface PruneResult {
    readonly ran: boolean;
    readonly removed: number;
    readonly bytesFreed: number;
    /** Total size after pruning, or -1 when the run was skipped by the throttle. */
    readonly totalBytes: number;
    readonly protectedBytes: number;
    readonly protectedCount: number;
    readonly overLimit: boolean;
}
/** Test hook: forget the throttle window. */
export declare function resetPruneThrottle(): void;
/**
 * Enforce retention limits.
 * @param root - backup root.
 * @param policy - limits.
 * @param options.bypassThrottle - evaluate immediately (used in degraded state).
 */
export declare function prune(root: string, policy: RetentionPolicy, options?: {
    readonly bypassThrottle?: boolean;
}): Promise<PruneResult>;
export interface CapacityResult {
    readonly ok: boolean;
    readonly reason?: 'disk' | 'quota';
    readonly detail?: string;
    readonly advice?: string;
    readonly totalBytes: number;
    readonly protectedBytes: number;
}
/** Warn at most once per five minutes, so a degraded state cannot spam the log. */
export declare function warnThrottled(message: string): void;
/** Test hook: forget the warning window. */
export declare function resetWarnThrottle(): void;
/**
 * Decide whether one more snapshot of `requiredBytes` may be written.
 *
 * Runs before the write so a snapshot always exists before a file changes, and
 * never deletes anything unless a limit is actually exceeded.
 */
export declare function ensureCapacity(root: string, requiredBytes: number, policy: RetentionPolicy, options?: {
    readonly degraded?: boolean;
}): Promise<CapacityResult>;
