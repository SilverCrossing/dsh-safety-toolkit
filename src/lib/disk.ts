/**
 * Disk space probes.
 *
 * Two partitions matter: the one holding the backup root (a snapshot that
 * cannot be written means no rollback) and the one holding the edited file
 * (a half-written file is worse than a rejected edit).
 */

import { mkdir, statfs } from 'node:fs/promises'

/** Free bytes on the filesystem containing `path`, or undefined when unknown. */
export async function freeBytes(path: string): Promise<number | undefined> {
  try {
    await mkdir(path, { recursive: true })
    const stats = await statfs(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return undefined
  }
}

export interface SpaceVerdict {
  readonly ok: boolean
  readonly freeBytes?: number
  readonly requiredBytes: number
  readonly target: string
}

/** Require a minimum free space on the filesystem that holds `path`. */
export async function requireSpace(path: string, requiredBytes: number): Promise<SpaceVerdict> {
  const free = await freeBytes(path)
  if (free === undefined) return { ok: true, requiredBytes, target: path }
  return { ok: free >= requiredBytes, freeBytes: free, requiredBytes, target: path }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}
