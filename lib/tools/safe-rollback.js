/**
 * `safe_rollback` — restore a previous snapshot of one file.
 *
 * Rollbacks are repeatable: the backup being read stays on disk, and the state
 * replaced by the rollback is snapshotted, so the operation is itself undoable.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { restoreBackup } from '../lib/backup.js';
import { OUTCOME_SCHEMA, renderOutcome } from '../lib/outcome.js';
import { resolveInsideWorkspace } from '../lib/paths.js';
import { workspaceOf } from '../lib/workspace.js';
export function safeRollbackTool(ctx) {
    return defineTool({
        name: 'safe_rollback',
        description: [
            '把文件回滚到某个历史快照；不指定 backup_name 时回滚到最近一次改动前的版本。',
            '回滚不会消耗备份，同一版本可以反复回滚；回滚前的当前内容会另存为撤销点（pre-rollback），可用它撤销本次回滚。',
        ].join(' '),
        parameters: {
            filepath: { type: 'string', required: true, description: '要回滚的文件路径' },
            backup_name: { type: 'string', description: '指定备份文件名（可用 safe_backups 查询），省略则用最近一次改动前快照' },
        },
        output: {
            schema: OUTCOME_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
        },
        async execute(args, exec) {
            const workspace = await workspaceOf(ctx, exec);
            const absolute = await resolveInsideWorkspace(workspace, args.filepath);
            const result = await restoreBackup(workspace, absolute, args.backup_name);
            if (result.restored === undefined) {
                return {
                    ok: false,
                    message: `没有找到可回滚的快照：${absolute}`,
                    next: '用 safe_backups 确认该文件是否有快照；只有被 safe_edit / safe_write / multi_edit 修改过的文件才会产生快照。',
                };
            }
            const undo = result.preRollback !== undefined
                ? `；回滚前的状态已存为 ${result.preRollback.id}，可用它撤销本次回滚`
                : result.undoSkipReason === undefined
                    ? ''
                    : `；注意：本次回滚没有生成撤销点（${result.undoSkipReason}），无法撤回这次回滚`;
            return {
                ok: true,
                message: result.deleted
                    ? `已回到「文件原本不存在」的状态（使用快照 ${result.restored.id}）${undo}`
                    : `已回滚到快照 ${result.restored.id}${undo}`,
                files: [{ path: absolute, backupId: result.restored.id, changed: true }],
            };
        },
    });
}
