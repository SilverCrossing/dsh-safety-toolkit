/**
 * Safety toolkit plugin entry.
 *
 * Registers the seven tools, then publishes a machine-readable contract so that
 * guard plugins can discover which tool names this package provides and which
 * built-in names it replaces.
 *
 * Governance (denying the built-in `write`/`edit`) lives in `governance.ts` so
 * the two can be enabled independently.
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import { TOOL_CONTRACT, type ToolContract } from './contract.js';
export { TOOL_CONTRACT };
export type { ToolContract, ToolContractEntry } from './contract.js';
export declare const name = "safety-toolkit";
export declare const inject: string[];
/**
 * Exposes the contract as the `safetyToolkit` service, so a guard can
 * `inject: ['safetyToolkit']` and read `.contract` without importing this
 * package. Registering is best-effort: a failure must not cost the tools.
 */
export declare class SafetyToolkitContractService extends Service {
    readonly contract: ToolContract;
    constructor(ctx: Context);
}
export declare function apply(ctx: Context): void;
