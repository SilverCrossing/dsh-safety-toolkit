/**
 * Workspace boundary enforcement.
 *
 * Every path a tool touches is resolved against the agent working directory and
 * refused when it escapes. Symlinks are resolved for the deepest existing
 * ancestor, so a link planted inside the workspace cannot smuggle a write out.
 */
export declare class WorkspaceBoundaryError extends Error {
    readonly target: string;
    readonly root: string;
    constructor(target: string, root: string);
}
/** Whether `absolute` is the root itself or lies underneath it. */
export declare function isInside(root: string, absolute: string): boolean;
/**
 * Resolve a caller-supplied path against the workspace root.
 * @param root - absolute workspace directory.
 * @param target - absolute or workspace-relative path.
 * @returns The absolute path with symlinks resolved, guaranteed to stay inside `root`.
 * @throws WorkspaceBoundaryError when the resolved path escapes the workspace.
 */
export declare function resolveInsideWorkspace(root: string, target: string): Promise<string>;
