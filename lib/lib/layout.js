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
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
/** Directory placed inside every per-file folder to record the source path. */
export const SOURCE_META = 'source.json';
const MAX_BASENAME = 60;
const SEPARATOR = '~';
function hash8(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 8);
}
/** Strip characters that would break the `~`-separated name or the host filesystem. */
export function sanitizeBasename(name) {
    const cleaned = name.replace(/[~\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    const bounded = cleaned.length > MAX_BASENAME ? cleaned.slice(0, MAX_BASENAME) : cleaned;
    return bounded === '' ? 'unnamed' : bounded;
}
/**
 * Global backup root. A relative `DSH_SAFETY_BACKUP_DIR` resolves against the
 * user's home directory, never the process cwd: the same config must point at
 * the same place no matter where dsh was launched from.
 */
export function backupRoot() {
    const override = process.env.DSH_SAFETY_BACKUP_DIR;
    if (override !== undefined && override.trim() !== '') {
        const value = override.trim();
        return value.startsWith('~') ? resolve(homedir(), value.slice(1)) : resolve(homedir(), value);
    }
    const home = process.env.DSH_HOME?.trim();
    const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh');
    return join(base, 'safety-backups');
}
/** Per-file snapshot directory name. */
export function fileDirectoryName(workspace, absolute) {
    const root = resolve(workspace);
    const target = resolve(absolute);
    const relativePath = relative(root, target).split(sep).join('/');
    return `${sanitizeBasename(basename(target))}${SEPARATOR}${hash8(root)}${SEPARATOR}${hash8(relativePath)}`;
}
/** Timestamp that sorts lexicographically in chronological order. */
export function stampOf(date) {
    const iso = date.toISOString();
    return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`;
}
/** Milliseconds encoded in a stamp, or undefined when it is malformed. */
export function parseStamp(stamp) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z(?:-\d+)?$/.exec(stamp);
    if (match === null)
        return undefined;
    const [, year, month, day, hour, minute, second, millisecond] = match;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond));
}
const SNAPSHOT_NAME = /^(\d{8}T\d{6}\d{3}Z(?:-\d+)?)~(edit|rollback)(-absent)?\.bak(\.keep)?$/;
export function buildSnapshotName(stamp, kind, absent, protectedFlag) {
    return `${stamp}${SEPARATOR}${kind}${absent ? '-absent' : ''}.bak${protectedFlag ? '.keep' : ''}`;
}
export function parseSnapshotName(name) {
    const match = SNAPSHOT_NAME.exec(name);
    if (match === null)
        return undefined;
    const time = parseStamp(match[1]);
    if (time === undefined)
        return undefined;
    return {
        stamp: match[1],
        kind: match[2],
        absent: match[3] === '-absent',
        protected: match[4] === '.keep',
        time,
    };
}
/** Add or remove the protection suffix on a snapshot file name. */
export function withProtection(name, protectedFlag) {
    const parsed = parseSnapshotName(name);
    if (parsed === undefined)
        return name;
    return buildSnapshotName(parsed.stamp, parsed.kind, parsed.absent, protectedFlag);
}
