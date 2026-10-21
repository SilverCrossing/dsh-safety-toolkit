/** `safe_rollback` — restore the newest (or a named) backup for one file. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { restoreBackup } from '../lib/backup.js';
import { OUTCOME_SCHEMA, renderOutcome } from '../lib/outcome.js';
import { resolveInsideWorkspace } from '../lib/paths.js';
import { workspaceOf } from '../lib/workspace.js';
export function safeRollbackTool(ctx) {
    return defineTool({
        name: 'safe_rollback',
        description: '把文件回滚到 safe_edit / safe_write 留下的某个备份版本；不指定 backup_name 时回滚到最近一次。',
        parameters: {
            filepath: { type: 'string', required: true, description: '要回滚的文件路径' },
            backup_name: { type: 'string', description: '指定备份文件名，省略则用最近一次' },
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
                    message: `没有找到可用的备份：${absolute}`,
                    next: '先用 safe_backups 列出可用备份，或确认该文件是否被 safe_* 工具修改过。',
                };
            }
            return {
                ok: true,
                message: result.deleted
                    ? `已回滚到「文件原本不存在」的状态（备份 ${result.restored.id}）`
                    : `已回滚到备份 ${result.restored.id}`,
                files: [{ path: absolute, backupId: result.restored.id, changed: true }],
            };
        },
    });
}
