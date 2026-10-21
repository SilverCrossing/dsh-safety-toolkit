/**
 * Safety governance plugin.
 *
 * Two jobs, both deliberately weak-mechanism:
 *  1. A global monotonic guard denies the built-in `write` / `edit` and points
 *     at the safe replacements. Guards cannot be overridden by later listeners,
 *     and being global it also covers subagents, which do not inherit scoped
 *     tool restrictions.
 *  2. A prompt section states the soft rule for `bash`, which this plugin does
 *     NOT hard-block: shell redirection can write files in ways a tool-level
 *     guard cannot reliably inspect.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "safety-governance";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
