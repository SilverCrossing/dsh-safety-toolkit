/**
 * Safety governance plugin.
 *
 * Three jobs, ordered from weakest to strongest mechanism:
 *  1. A prompt section that states the soft rule for the shell tool actually
 *     present in this deployment (`bash` or `pwsh`, not a hard-coded name).
 *  2. Per-agent `tools.restrict({ deny })` so `write` / `edit` leave the tool
 *     list and the prompt entirely — the model cannot "fall back" to a name it
 *     never sees.
 *  3. A global monotonic guard as the floor. Guards cannot be overridden by
 *     later listeners, and unlike scoped restrictions they also cover
 *     subagents, which do not inherit scoped registrations.
 *
 * The shell is intentionally NOT hard-blocked: redirection writes files in ways
 * a tool-level guard cannot reliably inspect, and pretending otherwise would be
 * security theater.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "safety-governance";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
