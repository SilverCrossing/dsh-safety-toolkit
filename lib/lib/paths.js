/**
 * Workspace boundary enforcement.
 *
 * Every path a tool touches is resolved against the agent working directory and
 * refused when it escapes. Symlinks are resolved for the deepest existing
 * ancestor, so a link planted inside the workspace cannot smuggle a write out.
 */
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
export class WorkspaceBoundaryError extends Error {
    target;
    root;
    constructor(target, root) {
        super(`路径越界：${target} 解析后位于工作区 ${root} 之外，已拒绝本次操作`);
        this.target = target;
        this.root = root;
        this.name = 'WorkspaceBoundaryError';
    }
}
/** Whether `absolute` is the root itself or lies underneath it. */
export function isInside(root, absolute) {
    const rel = relative(root, absolute);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
/** Deepest ancestor of `absolute` that actually exists on disk. */
async function deepestExisting(absolute) {
    let current = absolute;
    for (;;) {
        try {
            await realpath(current);
            return current;
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return current;
            current = parent;
        }
    }
}
/**
 * Resolve a caller-supplied path against the workspace root.
 * @param root - absolute workspace directory.
 * @param target - absolute or workspace-relative path.
 * @returns The absolute path with symlinks resolved, guaranteed to stay inside `root`.
 * @throws WorkspaceBoundaryError when the resolved path escapes the workspace.
 */
export async function resolveInsideWorkspace(root, target) {
    const realRoot = await realpath(root).catch(() => resolve(root));
    const absolute = isAbsolute(target) ? resolve(target) : resolve(realRoot, target);
    if (!isInside(realRoot, absolute))
        throw new WorkspaceBoundaryError(target, realRoot);
    const existing = await deepestExisting(absolute);
    const realExisting = await realpath(existing).catch(() => existing);
    if (!isInside(realRoot, realExisting))
        throw new WorkspaceBoundaryError(target, realRoot);
    const tail = relative(existing, absolute);
    return tail === '' ? realExisting : resolve(realExisting, tail);
}
