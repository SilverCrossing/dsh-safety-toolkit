/**
 * Append-only audit trail for the toolkit's own tool calls.
 *
 * Layout: `<root>/<YYYY-MM-DD>.jsonl` — one flat file per local day, one JSON
 * per line. Flat beats per-day folders here: fewer inodes, one file to grep,
 * and the whole week fits in a single `Select-String`.
 *
 * Goals, in order:
 *  1. Answer "who touched this file, when, and with what result" after the fact.
 *  2. Never break a tool call. Every write is best-effort and swallowed.
 *  3. Stay small: one line per call, daily rotation, hard per-file cap.
 *
 * It deliberately records no file contents — only paths, outcome and a short
 * reason. Contents already live in snapshots; duplicating them here would make
 * the log both larger and more sensitive for no diagnostic gain.
 */

import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000

export interface AuditPolicy {
  readonly enabled: boolean
  readonly root: string
  readonly retentionDays: number
  /** Stop appending once one day's file reaches this size. */
  readonly maxFileBytes: number
}

export interface AuditEntry {
  /** Local ISO timestamp with offset, e.g. 2026-10-24T20:36:12.345+08:00 */
  readonly ts: string
  readonly tool: string
  readonly ok: boolean
  /** Target paths extracted from the call arguments. */
  readonly paths: readonly string[]
  /** Snapshot id when the call produced one. */
  readonly backup?: string
  /** Short failure reason; never file content. */
  readonly detail?: string
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/** Audit root — a flat `log` directory beside the snapshot root. */
export function auditRoot(): string {
  const override = process.env.DSH_SAFETY_AUDIT_DIR?.trim()
  if (override !== undefined && override !== '') {
    return override.startsWith('~')
      ? join(homedir(), override.slice(1))
      : override
  }
  const home = process.env.DSH_HOME?.trim()
  const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'log')
}

export function loadAuditPolicy(env: NodeJS.ProcessEnv = process.env): AuditPolicy {
  const disabled = (env.DSH_SAFETY_AUDIT ?? '').trim().toLowerCase()
  return {
    enabled: disabled !== 'off' && disabled !== '0' && disabled !== 'false',
    root: auditRoot(),
    retentionDays: positiveInt(env.DSH_SAFETY_AUDIT_DAYS, 7),
    maxFileBytes: positiveInt(env.DSH_SAFETY_AUDIT_MAX_MB, 10) * 1024 * 1024,
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** Local-time ISO with offset — readable without conversion. */
export function localIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

/** Local date used as the file name, e.g. `2026-10-24`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const LOG_NAME = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/

let lastWarnAt = 0
let lastPruneAt = 0
/** Serialises appends so lines land in causal order, not completion order. */
let writeChain: Promise<void> = Promise.resolve()
const WARN_INTERVAL_MS = 5 * 60 * 1000
/**
 * Prune cadence. Files rotate daily, so hourly sweeping buys nothing: six hours
 * keeps a deleted day's data around for at most a few extra hours, which costs
 * a few hundred KB at most.
 */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

function warnOnce(message: string): void {
  if (Date.now() - lastWarnAt < WARN_INTERVAL_MS) return
  lastWarnAt = Date.now()
  console.warn(`[safety-toolkit] ${message}`)
}

/** Test hooks. */
export function resetAuditState(): void {
  lastWarnAt = 0
  lastPruneAt = 0
  writeChain = Promise.resolve()
}

/** Remove day files older than the retention window. Best effort. */
export async function pruneAudit(policy: AuditPolicy, now = Date.now()): Promise<number> {
  if (policy.retentionDays <= 0) return 0
  let removed = 0
  try {
    const entries = await readdir(policy.root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = LOG_NAME.exec(entry.name)
      if (match === null) continue
      const dayStart = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
      if (Number.isNaN(dayStart)) continue
      // Keep the whole day the cutoff falls in, so "7 days" means 7 complete days.
      if (now - dayStart > policy.retentionDays * DAY_MS + DAY_MS) {
        await rm(join(policy.root, entry.name), { force: true }).catch(() => {})
        removed += 1
      }
    }
  } catch {
    // Missing root or unreadable directory: nothing to prune.
  }
  return removed
}

/**
 * Append one entry. Never throws: a broken audit trail must not break the tool
 * call it is describing. Concurrent calls are queued, so lines keep the order
 * the calls actually happened in.
 */
export function appendAudit(entry: AuditEntry, policy = loadAuditPolicy()): Promise<void> {
  writeChain = writeChain.then(() => writeEntry(entry, policy)).catch(() => {})
  return writeChain
}

async function writeEntry(entry: AuditEntry, policy: AuditPolicy): Promise<void> {
  if (!policy.enabled) return

  const now = new Date()
  const file = join(policy.root, `${dayOf(now)}.jsonl`)

  try {
    await mkdir(policy.root, { recursive: true, mode: 0o700 })

    const size = await stat(file).then(info => info.size).catch(() => 0)
    if (size >= policy.maxFileBytes) {
      warnOnce(`审计日志 ${file} 已达上限 ${policy.maxFileBytes} 字节，今日后续操作不再记录`)
      return
    }

    await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    warnOnce(`审计日志写入失败（不影响本次操作）：${(error as Error).message}`)
    return
  }

  // Hourly, not per write: pruning is maintenance, not part of the hot path.
  if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) {
    lastPruneAt = Date.now()
    void pruneAudit(policy).catch(() => {})
  }
}

/** Extract string values addressed by a contract path such as `edits[].file`. */
export function extractPaths(args: unknown, path: string): string[] {
  let current: unknown[] = [args]
  for (const segment of path.split('.')) {
    const isArray = segment.endsWith('[]')
    const key = isArray ? segment.slice(0, -2) : segment
    const next: unknown[] = []
    for (const item of current) {
      if (item === null || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (isArray) {
        if (Array.isArray(value)) next.push(...value)
      } else {
        next.push(value)
      }
    }
    current = next
  }
  return current.filter((value): value is string => typeof value === 'string' && value !== '')
}
