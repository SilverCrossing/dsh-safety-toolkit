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
import { Service } from '@deepseek-ai/cordis';
import { TOOL_CONTRACT } from './contract.js';
import { safeBackupsTool } from './tools/safe-backups.js';
import { safeEditTool } from './tools/safe-edit.js';
import { safeRollbackTool } from './tools/safe-rollback.js';
import { safeWriteTool } from './tools/safe-write.js';
import { multiEditTool } from './tools/multi-edit.js';
import { syntaxCheckTool } from './tools/syntax-check.js';
import { testRunnerTool } from './tools/test-runner.js';
export { TOOL_CONTRACT };
export const name = 'safety-toolkit';
export const inject = ['tools', 'workingDirectory'];
/**
 * Exposes the contract as the `safetyToolkit` service, so a guard can
 * `inject: ['safetyToolkit']` and read `.contract` without importing this
 * package. Registering is best-effort: a failure must not cost the tools.
 */
export class SafetyToolkitContractService extends Service {
    contract = TOOL_CONTRACT;
    constructor(ctx) {
        super(ctx, 'safetyToolkit');
    }
}
export function apply(ctx) {
    ctx.tools.register(safeEditTool(ctx));
    ctx.tools.register(safeWriteTool(ctx));
    ctx.tools.register(multiEditTool(ctx));
    ctx.tools.register(safeRollbackTool(ctx));
    ctx.tools.register(safeBackupsTool(ctx));
    ctx.tools.register(syntaxCheckTool(ctx));
    ctx.tools.register(testRunnerTool(ctx));
    try {
        new SafetyToolkitContractService(ctx);
    }
    catch (error) {
        // The contract is a convenience for other plugins; its absence must never
        // take the toolkit down.
        console.warn(`[safety-toolkit] 契约服务注册失败，工具不受影响：${error.message}`);
    }
}
