/**
 * Content-addressed backups stored inside the workspace.
 *
 * Layout:
 *   `<backup root>/<encoded-path>/<stamp>-<random>.bak`            edit snapshots
 *   `<backup root>/<encoded-path>/pre-rollback/<stamp>-<random>.bak`  rollback undo points
 *
 * A `.new` suffix records "this file did not exist before", so a rollback
 * deletes it instead of restoring empty content.
 *
 * Restoring never consumes the backup it reads: the same version can be rolled
 * back to repeatedly, and the state before each rollback is snapshotted into
 * `pre-rollback/` so the rollback itself can be undone.
 */
export declare const BACKUP_DIR_NAME = ".dsh-backups";
export type BackupKind = 'edit' | 'pre-rollback';
export interface BackupRecord {
    /** File name of the backup inside its kind directory. */
    readonly id: string;
    /** Absolute path of the file the backup restores. */
    readonly path: string;
    /** ISO-ish timestamp encoded in the file name. */
    readonly createdAt: string;
    /** False when the target did not exist before the tracked write. */
    readonly existed: boolean;
    readonly kind: BackupKind;
}
export interface RestoreResult {
    readonly restored?: BackupRecord;
    /** Snapshot of the content that the rollback replaced, for undoing the rollback. */
    readonly preRollback?: BackupRecord;
    /** True when the rollback removed the file (it did not exist before the edit). */
    readonly deleted: boolean;
}
/**
 * Backup root. `DSH_SAFETY_BACKUP_DIR` moves snapshots outside the workspace,
 * which keeps repository working trees clean.
 */
export declare function backupRoot(workspace: string): string;
/** Stable, human-readable directory name for one absolute path. */
export declare function encodePath(workspace: string, absolute: string): string;
export declare function exists(absolute: string): Promise<boolean>;
/**
 * Snapshot the previous content of one file.
 * @param workspace - absolute workspace root.
 * @param absolute - absolute path of the file about to be written.
 * @param previous - previous content, or null when the file did not exist.
 * @param kind - `edit` for pre-write snapshots, `pre-rollback` for undo points.
 */
export declare function createBackup(workspace: string, absolute: string, previous: string | null, kind?: BackupKind): Promise<BackupRecord>;
/** List backups newest-first, optionally filtered to one file. */
export declare function listBackups(workspace: string, absolute?: string): Promise<BackupRecord[]>;
/**
 * Restore the newest (or a named) backup for one file.
 *
 * The consumed backup is kept on disk, and the content being replaced is
 * snapshotted first, so repeated rollbacks walk history deterministically
 * instead of silently consuming versions.
 */
export declare function restoreBackup(workspace: string, absolute: string, backupName?: string): Promise<RestoreResult>;
