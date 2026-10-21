/** `safe_backups` — list available snapshots before deciding what to roll back. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { listBackups } from '../lib/backup.js'
import { OUTCOME_SCHEMA, renderOutcome, type ToolOutcome } from '../lib/outcome.js'
import { resolveInsideWorkspace } from '../lib/paths.js'
import { workspaceOf } from '../lib/workspace.js'

export function safeBackupsTool(ctx: Context) {
  return defineTool({
    name: 'safe_backups',
    description: '列出工作区里的快照记录（含改动前快照与回滚撤销点），可按文件过滤。回滚前先用它确认有哪些版本可选。',
    parameters: {
      filepath: { type: 'string', description: '只看某个文件的快照，省略则列出全部' },
    },
    output: {
      schema: OUTCOME_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value as ToolOutcome) }],
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)
      const absolute = args.filepath === undefined || args.filepath === ''
        ? undefined
        : await resolveInsideWorkspace(workspace, args.filepath)

      const records = await listBackups(workspace, absolute)
      if (records.length === 0) {
        return {
          ok: true,
          message: absolute === undefined ? '工作区里还没有任何快照' : `${absolute} 没有快照记录`,
          files: [],
        }
      }

      const shown = records.slice(0, 40)
      return {
        ok: true,
        message: `共 ${records.length} 条快照记录（最新在前），kind=edit 为改动前快照，kind=pre-rollback 为回滚撤销点`,
        files: shown.map(record => ({ path: record.path, backupId: `${record.id} [${record.kind}]`, changed: false })),
      }
    },
  })
}
