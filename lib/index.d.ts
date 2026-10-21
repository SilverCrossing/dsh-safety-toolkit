/**
 * Safety toolkit plugin entry.
 *
 * Registers the seven first-phase tools. Governance (denying the built-in
 * `write`/`edit`) lives in `governance.ts` so the two can be enabled
 * independently: a deployment can adopt the tools first, then tighten policy.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "safety-toolkit";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
