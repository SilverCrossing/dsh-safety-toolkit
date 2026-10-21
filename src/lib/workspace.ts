/**
 * Resolve the workspace an execution belongs to.
 *
 * The working directory always comes from the execution context (the agent the
 * call runs on behalf of), never from tool arguments: a caller-supplied root
 * would let the model redefine its own boundary.
 */

import type { Context } from '@deepseek-ai/cordis'

export interface ToolkitServices {
  readonly workingDirectory: {
    ensure(agent: never, signal?: AbortSignal): Promise<string>
    readonly defaultDirectory?: string
  }
}

export interface ExecutionScope {
  readonly agent?: unknown
  readonly signal: AbortSignal
}

/**
 * Read the agent working directory for one execution.
 * @param ctx - plugin context with the `workingDirectory` service injected.
 * @param exec - execution identity carrying the calling agent and its signal.
 */
export async function workspaceOf(ctx: Context, exec: ExecutionScope): Promise<string> {
  const services = ctx as unknown as ToolkitServices
  const agent = exec.agent
  if (agent !== undefined) {
    return await services.workingDirectory.ensure(agent as never, exec.signal)
  }
  const fallback = services.workingDirectory.defaultDirectory
  if (typeof fallback === 'string' && fallback !== '') return fallback
  return process.cwd()
}
