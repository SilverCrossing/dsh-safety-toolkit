/**
 * Disk space probes.
 *
 * Two partitions matter: the one holding the backup root (a snapshot that
 * cannot be written means no rollback) and the one holding the edited file
 * (a half-written file is worse than a rejected edit).
 */
/** Free bytes on the filesystem containing `path`, or undefined when unknown. */
export declare function freeBytes(path: string): Promise<number | undefined>;
export interface SpaceVerdict {
    readonly ok: boolean;
    readonly freeBytes?: number;
    readonly requiredBytes: number;
    readonly target: string;
}
/** Require a minimum free space on the filesystem that holds `path`. */
export declare function requireSpace(path: string, requiredBytes: number): Promise<SpaceVerdict>;
export declare function formatBytes(bytes: number): string;
