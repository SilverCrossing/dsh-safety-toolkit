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
import { Service } from '@deepseek-ai/cordis';
import { TOOL_CONTRACT } from './contract.js';
import { appendAudit, extractPaths, localIso } from './lib/audit.js';
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
/** Tool name → path arguments, derived once from the public contract. */
const AUDITED = new Map(TOOL_CONTRACT.tools.map(entry => [entry.name, entry.pathArgs]));
function firstText(content) {
    for (const block of content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
            return block.text.slice(0, 200);
        }
    }
    return undefined;
}
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
        console.warn(`[safety-toolkit] 契约服务注册失败，工具不受影响：${error.message}`);
    }
    try {
        const services = ctx;
        services.on('tools/result', (exec, result) => {
            const pathArgs = AUDITED.get(exec.name);
            if (pathArgs === undefined)
                return;
            const paths = pathArgs.flatMap(argPath => extractPaths(exec.arguments, argPath));
            const backup = result.value?.files?.[0]?.backupId;
            const detail = result.isError === true ? firstText(result.content) : undefined;
            const callId = exec.callId === undefined ? undefined : String(exec.callId);
            void appendAudit({
                ts: localIso(new Date()),
                ...(callId === undefined ? {} : { callId }),
                tool: exec.name,
                ok: result.isError !== true,
                paths,
                ...(backup === undefined ? {} : { backup }),
                ...(detail === undefined ? {} : { detail }),
            }).catch(() => { });
        });
    }
    catch (error) {
        // Auditing is useful, not essential.
        console.warn(`[safety-toolkit] 审计日志监听注册失败，工具不受影响：${error.message}`);
    }
}
