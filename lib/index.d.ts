/**
 * Safety toolkit plugin entry.
 *
 * Registers the seven tools, publishes a machine-readable contract, and writes
 * an append-only audit trail for every call to its own tools.
 *
 * The audit listener rides `tools/result`: an emit-only observation point that
 * receives the frozen final outcome, so it can never alter a result and a
 * throwing listener cannot fail the call.
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
