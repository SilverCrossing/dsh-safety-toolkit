/**
 * Snapshot storage: one directory per source file inside a global root.
 *
 *   <root>/<basename>~<wsHash8>~<relHash8>/
 *     source.json                      records the original absolute path
 *     20261021T190500123Z~edit.bak
 *     20261021T190530456Z~rollback.bak.keep
 *
 * Restoring never consumes the snapshot it reads; the state being replaced is
 * snapshotted into a `rollback` entry first (best effort) so a rollback can be
 * undone. If that undo point cannot be written, the rollback still proceeds and
 * says so — being unable to roll back is worse than lacking an undo point.
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  backupRoot,
  buildSnapshotName,
  fileDirectoryName,
  parseSnapshotName,
  parseStamp,
  SOURCE_META,
  stampOf,
  withProtection,
  type BackupKind,
} from './layout.js'
import { ensureCapacity, loadPolicy } from './retention.js'

export { SOURCE_META } from './layout.js'
export type { BackupKind } from './layout.js'

export interface BackupRecord {
  /** Snapshot file name, safe to pass back as `backup_name`. */
  readonly id: string
  /** Absolute path of the file this snapshot restores. */
  readonly path: string
  /** ISO-ish timestamp derived from the file name. */
  readonly createdAt: string
  /** False when the file did not exist before the tracked write. */
  readonly existed: boolean
  readonly kind: BackupKind
  /** True when the `.keep` suffix prevents automatic removal. */
  readonly protected: boolean
  readonly size: number
}

export interface RestoreResult {
  readonly restored?: BackupRecord
  /** Snapshot of the content that the rollback replaced, for undoing the rollback. */
  readonly preRollback?: BackupRecord
  /** True when the rollback removed the file (it did not exist before the edit). */
  readonly deleted: boolean
  /** Why no undo point was written, when one was expected but skipped. */
  readonly undoSkipReason?: string
}

export async function exists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute)
    return true
  } catch {
    return false
  }
}

export function backupDirFor(workspace: string, absolute: string): string {
  return join(backupRoot(), fileDirectoryName(workspace, absolute))
}

async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700).catch(() => {})
}

async function ensureSourceMeta(directory: string, workspace: string, absolute: string): Promise<void> {
  const target = join(directory, SOURCE_META)
  if (await exists(target)) return
  await writeFile(target, JSON.stringify({ workspace, path: absolute }, null, 2), { mode: 0o600, encoding: 'utf8' })
}

interface SourceMeta {
  readonly workspace: string
  readonly path: string
}

async function readSourceMeta(directory: string): Promise<SourceMeta | undefined> {
  try {
    const raw = await readFile(join(directory, SOURCE_META), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    if (typeof record.workspace !== 'string' || typeof record.path !== 'string') return undefined
    return { workspace: record.workspace, path: record.path }
  } catch {
    return undefined
  }
}

async function uniqueStamp(directory: string, kind: BackupKind, absent: boolean): Promise<string> {
  const base = stampOf(new Date())
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const stamp = attempt === 1 ? base : `${base}-${attempt}`
    if (!(await exists(join(directory, buildSnapshotName(stamp, kind, absent, false))))) return stamp
  }
  return `${base}-${randomUUID().slice(0, 4)}`
}

/**
 * Write one snapshot.
 * @param workspace - workspace root, used for the directory hash and metadata.
 * @param absolute - absolute path of the file being snapshotted.
 * @param previous - previous content, or null when the file did not exist.
 * @param kind - `edit` for pre-write snapshots, `rollback` for undo points.
 */
export async function createBackup(
  workspace: string,
  absolute: string,
  previous: string | null,
  kind: BackupKind = 'edit',
): Promise<BackupRecord> {
  const directory = backupDirFor(workspace, absolute)
  await ensureDirectory(directory)
  await ensureSourceMeta(directory, workspace, absolute)

  const absent = previous === null
  const stamp = await uniqueStamp(directory, kind, absent)
  const name = buildSnapshotName(stamp, kind, absent, false)
  const target = join(directory, name)
  await writeFile(target, previous ?? '', { mode: 0o600, encoding: 'utf8' })
  await chmod(target, 0o600).catch(() => {})

  return {
    id: name,
    path: absolute,
    createdAt: stamp,
    existed: !absent,
    kind,
    protected: false,
    size: Buffer.byteLength(previous ?? '', 'utf8'),
  }
}

async function readDirectoryRecords(directory: string, fallbackPath: string): Promise<BackupRecord[]> {
  const names = await readdir(directory).catch(() => [] as string[])
  const records: BackupRecord[] = []
  for (const name of names) {
    const parsed = parseSnapshotName(name)
    if (parsed === undefined) continue
    const size = await stat(join(directory, name)).then(info => info.size).catch(() => 0)
    records.push({
      id: name,
      path: fallbackPath,
      createdAt: parsed.stamp,
      existed: !parsed.absent,
      kind: parsed.kind,
      protected: parsed.protected,
      size,
    })
  }
  return records
}

/** List snapshots newest-first, optionally scoped to one file. */
export async function listBackups(workspace: string, absolute?: string): Promise<BackupRecord[]> {
  if (absolute !== undefined) {
    const directory = backupDirFor(workspace, absolute)
    const records = await readDirectoryRecords(directory, absolute)
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return records
  }

  const root = backupRoot()
  const directories = await readdir(root, { withFileTypes: true }).catch(() => [])
  const records: BackupRecord[] = []
  for (const entry of directories) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    const meta = await readSourceMeta(directory)
    const records_ = await readDirectoryRecords(directory, meta?.path ?? entry.name)
    records.push(...records_)
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return records
}

/**
 * Restore the newest (or a named) snapshot for one file.
 *
 * Snapshot kinds are considered separately: `edit` entries are the normal
 * rollback targets, `rollback` entries are undo points that must be requested
 * explicitly by name.
 */
export async function restoreBackup(
  workspace: string,
  absolute: string,
  backupName?: string,
): Promise<RestoreResult> {
  const directory = backupDirFor(workspace, absolute)
  const records = await readDirectoryRecords(directory, absolute)
  const edits = records.filter(record => record.kind === 'edit').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const undoPoints = records.filter(record => record.kind === 'rollback').sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  let chosen: BackupRecord | undefined
  if (backupName !== undefined && backupName !== '') {
    chosen = records.find(record => record.id === backupName)
  } else {
    chosen = edits.at(-1)
  }
  if (chosen === undefined) return { deleted: false }

  const content = await readFile(join(directory, chosen.id), 'utf8').catch(() => undefined)
  if (content === undefined) return { deleted: false }

  const current = await readFile(absolute, 'utf8').catch(() => null)
  const deleted = !chosen.existed
  const sameAsTarget = deleted ? current === null : current === content

  // Best effort: an undo point is nice, but a rollback that cannot proceed is worse.
  let preRollback: BackupRecord | undefined
  let undoSkipReason: string | undefined
  if (!sameAsTarget) {
    const required = Buffer.byteLength(current ?? '', 'utf8')
    const capacity = await ensureCapacity(backupRoot(), required, loadPolicy(), { degraded: true })
    if (capacity.ok) {
      preRollback = await createBackup(workspace, absolute, current, 'rollback').catch(() => undefined)
      if (preRollback === undefined) undoSkipReason = '撤销点写入失败'
    } else {
      undoSkipReason = capacity.detail ?? '备份配额或磁盘空间不足'
    }
  }

  if (deleted) await rm(absolute, { force: true })
  else await writeFile(absolute, content, 'utf8')

  return {
    restored: chosen,
    ...(preRollback === undefined ? {} : { preRollback }),
    deleted,
    ...(undoSkipReason === undefined ? {} : { undoSkipReason }),
  }
}

/** Add or remove the `.keep` protection suffix on one snapshot. */
export async function setProtection(
  workspace: string,
  absolute: string,
  id: string,
  protectedFlag: boolean,
): Promise<BackupRecord | undefined> {
  const directory = backupDirFor(workspace, absolute)
  const records = await readDirectoryRecords(directory, absolute)
  const record = records.find(entry => entry.id === id)
  if (record === undefined) return undefined
  if (record.protected === protectedFlag) return record

  const nextName = withProtection(record.id, protectedFlag)
  if (nextName === record.id) return undefined
  try {
    await rename(join(directory, record.id), join(directory, nextName))
  } catch {
    return undefined
  }
  return { ...record, id: nextName, protected: protectedFlag }
}

/** Remove one snapshot outright (manual cleanup). */
export async function deleteBackup(workspace: string, absolute: string, id: string): Promise<boolean> {
  const directory = backupDirFor(workspace, absolute)
  try {
    await unlink(join(directory, id))
    return true
  } catch {
    return false
  }
}

export { parseStamp }
