/**
 * Backup layout: pure path and name rules, no filesystem access.
 *
 * Root:      `DSH_SAFETY_BACKUP_DIR` or `<DSH_HOME|~/.dsh>/safety-backups`
 * Directory: `<basename>~<workspaceHash8>~<relativePathHash8>` — one per source file
 * File:      `<stamp>~<kind>[-absent].bak[.keep]`
 *
 * The two hashes keep snapshots from different workspaces or same-named files
 * apart inside one shared root, while the basename keeps the tree browsable.
 */
export type BackupKind = 'edit' | 'rollback';
/** Directory placed inside every per-file folder to record the source path. */
export declare const SOURCE_META = "source.json";
/** Strip characters that would break the `~`-separated name or the host filesystem. */
export declare function sanitizeBasename(name: string): string;
/**
 * Global backup root. A relative `DSH_SAFETY_BACKUP_DIR` resolves against the
 * user's home directory, never the process cwd: the same config must point at
 * the same place no matter where dsh was launched from.
 */
export declare function backupRoot(): string;
/** Per-file snapshot directory name. */
export declare function fileDirectoryName(workspace: string, absolute: string): string;
/** Timestamp that sorts lexicographically in chronological order. */
export declare function stampOf(date: Date): string;
/** Milliseconds encoded in a stamp, or undefined when it is malformed. */
export declare function parseStamp(stamp: string): number | undefined;
export interface ParsedSnapshotName {
    readonly stamp: string;
    readonly kind: BackupKind;
    readonly absent: boolean;
    readonly protected: boolean;
    readonly time: number;
}
export declare function buildSnapshotName(stamp: string, kind: BackupKind, absent: boolean, protectedFlag: boolean): string;
export declare function parseSnapshotName(name: string): ParsedSnapshotName | undefined;
/** Add or remove the protection suffix on a snapshot file name. */
export declare function withProtection(name: string, protectedFlag: boolean): string;
