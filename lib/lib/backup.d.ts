/**
 * Content-addressed backups stored inside the workspace.
 *
 * Layout: `<workspace>/.dsh-backups/<encoded-path>/<stamp>-<random>.bak`
 * A `.new` suffix records "this file did not exist before the write", so a
 * rollback deletes it instead of restoring empty content.
 */
export declare const BACKUP_DIR_NAME = ".dsh-backups";
export interface BackupRecord {
    /** File name of the backup inside the per-path directory. */
    readonly id: string;
    /** Absolute path of the file the backup restores. */
    readonly path: string;
    /** ISO timestamp of the backup. */
    readonly createdAt: string;
    /** False when the target did not exist before the tracked write. */
    readonly existed: boolean;
}
export declare function backupRoot(workspace: string): string;
/** Stable, human-readable directory name for one absolute path. */
export declare function encodePath(workspace: string, absolute: string): string;
export declare function exists(absolute: string): Promise<boolean>;
/**
 * Snapshot the previous content of one file.
 * @param workspace - absolute workspace root.
 * @param absolute - absolute path of the file about to be written.
 * @param previous - previous content, or null when the file did not exist.
 * @returns The created backup record.
 */
export declare function createBackup(workspace: string, absolute: string, previous: string | null): Promise<BackupRecord>;
/** List backups newest-first, optionally filtered to one file. */
export declare function listBackups(workspace: string, absolute?: string): Promise<BackupRecord[]>;
/**
 * Restore the newest (or a named) backup for one file.
 * @returns A human-readable outcome summary.
 */
export declare function restoreBackup(workspace: string, absolute: string, backupName?: string): Promise<{
    restored: BackupRecord | undefined;
    deleted: boolean;
    previous: string | null;
}>;
