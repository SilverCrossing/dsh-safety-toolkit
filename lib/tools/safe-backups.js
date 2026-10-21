/** `safe_backups` — list available backups before deciding what to roll back. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { listBackups } from '../lib/backup.js';
import { OUTCOME_SCHEMA, renderOutcome } from '../lib/outcome.js';
import { resolveInsideWorkspace } from '../lib/paths.js';
import { workspaceOf } from '../lib/workspace.js';
export function safeBackupsTool(ctx) {
    return defineTool({
        name: 'safe_backups',
        description: '列出工作区里的备份记录，可按文件过滤。回滚前先用它确认有哪些版本可选。',
        parameters: {
            filepath: { type: 'string', description: '只看某个文件的备份，省略则列出全部' },
        },
        output: {
            schema: OUTCOME_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
        },
        async execute(args, exec) {
            const workspace = await workspaceOf(ctx, exec);
            const absolute = args.filepath === undefined || args.filepath === ''
                ? undefined
                : await resolveInsideWorkspace(workspace, args.filepath);
            const records = await listBackups(workspace, absolute);
            if (records.length === 0) {
                return {
                    ok: true,
                    message: absolute === undefined ? '工作区里还没有任何备份' : `${absolute} 没有备份记录`,
                    files: [],
                };
            }
            const preview = records.slice(0, 40).map(record => `${record.id}`).join('\n');
            return {
                ok: true,
                message: `共 ${records.length} 条备份记录（最新在前）`,
                files: records.slice(0, 40).map(record => ({ path: record.path, backupId: record.id, changed: false })),
                next: preview,
            };
        },
    });
}
