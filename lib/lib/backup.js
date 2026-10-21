/**
 * Content-addressed backups stored inside the workspace.
 *
 * Layout: `<workspace>/.dsh-backups/<encoded-path>/<stamp>-<random>.bak`
 * A `.new` suffix records "this file did not exist before the write", so a
 * rollback deletes it instead of restoring empty content.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
export const BACKUP_DIR_NAME = '.dsh-backups';
export function backupRoot(workspace) {
    return join(workspace, BACKUP_DIR_NAME);
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
/**
 * Snapshot the previous content of one file.
 * @param workspace - absolute workspace root.
 * @param absolute - absolute path of the file about to be written.
 * @param previous - previous content, or null when the file did not exist.
 * @returns The created backup record.
 */
export async function createBackup(workspace, absolute, previous) {
    const directory = join(backupRoot(workspace), encodePath(workspace, absolute));
    await mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const id = `${stamp}-${randomUUID().slice(0, 8)}${previous === null ? '.new' : '.bak'}`;
    const target = join(directory, id);
    if (previous !== null)
        await writeFile(target, previous, 'utf8');
    else
        await writeFile(target, '', 'utf8');
    return {
        id,
        path: absolute,
        createdAt: stamp,
        existed: previous !== null,
    };
}
/** List backups newest-first, optionally filtered to one file. */
export async function listBackups(workspace, absolute) {
    const root = backupRoot(workspace);
    // `encodePath` joins path segments with `__`, so a real directory name that
    // itself contains `__` is ambiguous. Acceptable for a backup index; the exact
    // absolute path is always available from the write that produced the backup.
    const directories = absolute === undefined
        ? (await readdir(root, { withFileTypes: true }).catch(() => []))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
        : [encodePath(workspace, absolute)];
    const records = [];
    for (const directory of directories) {
        const target = directory === '__root__'
            ? workspace
            : join(workspace, directory.split('__').join(sep));
        const names = await readdir(join(root, directory)).catch(() => []);
        for (const name of names) {
            const parsed = parseBackupName(target, name);
            if (parsed === undefined)
                continue;
            records.push(parsed);
        }
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return records;
}
function parseBackupName(absolute, name) {
    const match = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z)-[0-9a-f]{8}(\.new|\.bak)$/.exec(name);
    if (match === null)
        return undefined;
    return {
        id: name,
        path: absolute,
        createdAt: match[1],
        existed: match[2] === '.bak',
    };
}
/**
 * Restore the newest (or a named) backup for one file.
 * @returns A human-readable outcome summary.
 */
export async function restoreBackup(workspace, absolute, backupName) {
    const directory = join(backupRoot(workspace), encodePath(workspace, absolute));
    const names = await readdir(directory).catch(() => []);
    if (names.length === 0)
        return { restored: undefined, deleted: false, previous: null };
    const chosen = backupName ?? names.sort().at(-1);
    const source = join(directory, chosen);
    const content = await readFile(source, 'utf8').catch(() => undefined);
    if (content === undefined)
        return { restored: undefined, deleted: false, previous: null };
    const record = parseBackupName(absolute, chosen);
    const current = await readFile(absolute, 'utf8').catch(() => null);
    const deleted = chosen.endsWith('.new');
    if (deleted)
        await rm(absolute, { force: true });
    else
        await writeFile(absolute, content, 'utf8');
    await rm(source, { force: true });
    return { restored: record, deleted, previous: current };
}
