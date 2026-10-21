/**
 * Resolve the workspace an execution belongs to.
 *
 * The working directory always comes from the execution context (the agent the
 * call runs on behalf of), never from tool arguments: a caller-supplied root
 * would let the model redefine its own boundary.
 */
/**
 * Read the agent working directory for one execution.
 * @param ctx - plugin context with the `workingDirectory` service injected.
 * @param exec - execution identity carrying the calling agent and its signal.
 */
export async function workspaceOf(ctx, exec) {
    const services = ctx;
    const agent = exec.agent;
    if (agent !== undefined) {
        return await services.workingDirectory.ensure(agent, exec.signal);
    }
    const fallback = services.workingDirectory.defaultDirectory;
    if (typeof fallback === 'string' && fallback !== '')
        return fallback;
    return process.cwd();
}
