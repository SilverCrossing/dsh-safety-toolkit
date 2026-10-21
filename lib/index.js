/**
 * Safety toolkit plugin entry.
 *
 * Registers the seven first-phase tools. Governance (denying the built-in
 * `write`/`edit`) lives in `governance.ts` so the two can be enabled
 * independently: a deployment can adopt the tools first, then tighten policy.
 */
import { safeBackupsTool } from './tools/safe-backups.js';
import { safeEditTool } from './tools/safe-edit.js';
import { safeRollbackTool } from './tools/safe-rollback.js';
import { safeWriteTool } from './tools/safe-write.js';
import { multiEditTool } from './tools/multi-edit.js';
import { syntaxCheckTool } from './tools/syntax-check.js';
import { testRunnerTool } from './tools/test-runner.js';
export const name = 'safety-toolkit';
export const inject = ['tools', 'workingDirectory'];
export function apply(ctx) {
    ctx.tools.register(safeEditTool(ctx));
    ctx.tools.register(safeWriteTool(ctx));
    ctx.tools.register(multiEditTool(ctx));
    ctx.tools.register(safeRollbackTool(ctx));
    ctx.tools.register(safeBackupsTool(ctx));
    ctx.tools.register(syntaxCheckTool(ctx));
    ctx.tools.register(testRunnerTool(ctx));
}
