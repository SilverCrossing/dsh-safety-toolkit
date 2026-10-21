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
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
export const BACKUP_DIR_NAME = '.dsh-backups';
const PRE_ROLLBACK_DIR = 'pre-rollback';
/**
 * Backup root. `DSH_SAFETY_BACKUP_DIR` moves snapshots outside the workspace,
 * which keeps repository working trees clean.
 */
export function backupRoot(workspace) {
    const override = process.env.DSH_SAFETY_BACKUP_DIR;
    return override !== undefined && override.trim() !== '' ? override.trim() : join(workspace, BACKUP_DIR_NAME);
}
/** Stable, human-readable directory name for one absolute path. */
export function encodePath(workspace, absolute) {
    const rel = relative(workspace, absolute);
    return rel === '' ? '__root__' : rel.split(sep).join('__');
}
export async function exists(absolute) {
    try {
        await stat(absolute);
        return true;
    }
    catch {
        return false;
    }
}
function buildName(previous) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const suffix = previous === null ? '.new' : '.bak';
    return `${stamp}-${randomUUID().slice(0, 8)}${suffix}`;
}
function parseName(absolute, name, kind) {
    const match = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z)-[0-9a-f]{8}(\.new|\.bak)$/.exec(name);
    if (match === null)
        return undefined;
    return {
        id: name,
        path: absolute,
        createdAt: match[1],
        existed: match[2] === '.bak',
        kind,
    };
}
/**
 * Snapshot the previous content of one file.
 * @param workspace - absolute workspace root.
 * @param absolute - absolute path of the file about to be written.
 * @param previous - previous content, or null when the file did not exist.
 * @param kind - `edit` for pre-write snapshots, `pre-rollback` for undo points.
 */
export async function createBackup(workspace, absolute, previous, kind = 'edit') {
    const base = join(backupRoot(workspace), encodePath(workspace, absolute));
    const directory = kind === 'pre-rollback' ? join(base, PRE_ROLLBACK_DIR) : base;
    await mkdir(directory, { recursive: true });
    const id = buildName(previous);
    await writeFile(join(directory, id), previous ?? '', 'utf8');
    const stamp = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z)-/.exec(id);
    return {
        id,
        path: absolute,
        createdAt: stamp?.[1] ?? id,
        existed: previous !== null,
        kind,
    };
}
async function readRecords(base, absolute, kind) {
    const names = await readdir(base).catch(() => []);
    const records = [];
    for (const name of names) {
        const record = parseName(absolute, name, kind);
        if (record !== undefined)
            records.push(record);
    }
    return records;
}
/** List backups newest-first, optionally filtered to one file. */
export async function listBackups(workspace, absolute) {
    const root = backupRoot(workspace);
    // `encodePath` joins segments with `__`, so a real directory name containing
    // `__` is ambiguous. Acceptable for a backup index.
    const directories = absolute === undefined
        ? (await readdir(root, { withFileTypes: true }).catch(() => []))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
        : [encodePath(workspace, absolute)];
    const records = [];
    for (const directory of directories) {
        const target = directory === '__root__' ? workspace : join(workspace, directory.split('__').join(sep));
        const base = join(root, directory);
        records.push(...await readRecords(base, target, 'edit'));
        records.push(...await readRecords(join(base, PRE_ROLLBACK_DIR), target, 'pre-rollback'));
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return records;
}
/**
 * Restore the newest (or a named) backup for one file.
 *
 * The consumed backup is kept on disk, and the content being replaced is
 * snapshotted first, so repeated rollbacks walk history deterministically
 * instead of silently consuming versions.
 */
export async function restoreBackup(workspace, absolute, backupName) {
    const base = join(backupRoot(workspace), encodePath(workspace, absolute));
    const edits = (await readRecords(base, absolute, 'edit')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const undoPoints = (await readRecords(join(base, PRE_ROLLBACK_DIR), absolute, 'pre-rollback'))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let chosen;
    let source = base;
    if (backupName !== undefined && backupName !== '') {
        chosen = edits.find(record => record.id === backupName) ?? undoPoints.find(record => record.id === backupName);
        if (chosen !== undefined && chosen.kind === 'pre-rollback')
            source = join(base, PRE_ROLLBACK_DIR);
    }
    else {
        chosen = edits.at(-1);
    }
    if (chosen === undefined)
        return { deleted: false };
    const content = await readFile(join(source, chosen.id), 'utf8').catch(() => undefined);
    if (content === undefined)
        return { deleted: false };
    const current = await readFile(absolute, 'utf8').catch(() => null);
    const deleted = !chosen.existed;
    // Snapshot before mutating, so a rollback can itself be rolled back.
    const sameAsTarget = deleted ? current === null : current === content;
    const preRollback = sameAsTarget
        ? undefined
        : await createBackup(workspace, absolute, current, 'pre-rollback');
    if (deleted)
        await rm(absolute, { force: true });
    else
        await writeFile(absolute, content, 'utf8');
    return {
        restored: chosen,
        ...(preRollback === undefined ? {} : { preRollback }),
        deleted,
    };
}
