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
import { parseStamp, type BackupKind } from './layout.js';
export { SOURCE_META } from './layout.js';
export type { BackupKind } from './layout.js';
export interface BackupRecord {
    /** Snapshot file name, safe to pass back as `backup_name`. */
    readonly id: string;
    /** Absolute path of the file this snapshot restores. */
    readonly path: string;
    /** ISO-ish timestamp derived from the file name. */
    readonly createdAt: string;
    /** False when the file did not exist before the tracked write. */
    readonly existed: boolean;
    readonly kind: BackupKind;
    /** True when the `.keep` suffix prevents automatic removal. */
    readonly protected: boolean;
    readonly size: number;
}
export interface RestoreResult {
    readonly restored?: BackupRecord;
    /** Snapshot of the content that the rollback replaced, for undoing the rollback. */
    readonly preRollback?: BackupRecord;
    /** True when the rollback removed the file (it did not exist before the edit). */
    readonly deleted: boolean;
    /** Why no undo point was written, when one was expected but skipped. */
    readonly undoSkipReason?: string;
}
export declare function exists(absolute: string): Promise<boolean>;
export declare function backupDirFor(workspace: string, absolute: string): string;
/**
 * Write one snapshot.
 * @param workspace - workspace root, used for the directory hash and metadata.
 * @param absolute - absolute path of the file being snapshotted.
 * @param previous - previous content, or null when the file did not exist.
 * @param kind - `edit` for pre-write snapshots, `rollback` for undo points.
 */
export declare function createBackup(workspace: string, absolute: string, previous: string | null, kind?: BackupKind): Promise<BackupRecord>;
/** List snapshots newest-first, optionally scoped to one file. */
export declare function listBackups(workspace: string, absolute?: string): Promise<BackupRecord[]>;
/**
 * Restore the newest (or a named) snapshot for one file.
 *
 * Snapshot kinds are considered separately: `edit` entries are the normal
 * rollback targets, `rollback` entries are undo points that must be requested
 * explicitly by name.
 */
export declare function restoreBackup(workspace: string, absolute: string, backupName?: string): Promise<RestoreResult>;
/** Add or remove the `.keep` protection suffix on one snapshot. */
export declare function setProtection(workspace: string, absolute: string, id: string, protectedFlag: boolean): Promise<BackupRecord | undefined>;
/** Remove one snapshot outright (manual cleanup). */
export declare function deleteBackup(workspace: string, absolute: string, id: string): Promise<boolean>;
export { parseStamp };
