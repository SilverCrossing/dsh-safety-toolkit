/** `safe_backups` — inspect and manage snapshots: list, protect (`pin`), unprotect (`unpin`). */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { listBackups, setProtection } from '../lib/backup.js'
import { formatBytes } from '../lib/disk.js'
import { resolveInsideWorkspace } from '../lib/paths.js'
import { workspaceOf } from '../lib/workspace.js'

const BACKUPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '操作是否成功' },
    message: { type: 'string', description: '一句话结果摘要' },
    backups: {
      type: 'array',
      description: '快照列表，最新在前',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '快照文件名，可直接传给 safe_rollback 的 backup_name' },
          path: { type: 'string', description: '该快照对应的原文件绝对路径' },
          kind: { type: 'string', description: 'edit=改动前快照；rollback=回滚撤销点' },
          createdAt: { type: 'string', description: '快照时间戳' },
          existed: { type: 'boolean', description: '快照记录前文件是否存在' },
          protected: { type: 'boolean', description: '是否受 .keep 保护（不会自动删除）' },
          size: { type: 'integer', description: '快照字节数' },
        },
      },
    },
    next: { type: 'string', description: '下一步建议' },
  },
} as const

interface BackupView {
  readonly id: string
  readonly path: string
  readonly kind: string
  readonly createdAt: string
  readonly existed: boolean
  readonly protected: boolean
  readonly size: number
}

export function safeBackupsTool(ctx: Context) {
  return defineTool({
    name: 'safe_backups',
    description: [
      '查看快照并管理保护标记。id 是干净的快照文件名，可直接作为 safe_rollback 的 backup_name。',
      'kind=edit 是改动前快照（回滚默认目标），kind=rollback 是回滚撤销点。',
      '传 pin 可把某个快照标记为受保护（永不自动删除），传 unpin 取消保护；两者都需要同时传 filepath。',
    ].join(' '),
    parameters: {
      filepath: { type: 'string', description: '限定到某个文件的快照；使用 pin / unpin 时必填' },
      pin: { type: 'string', description: '要标记为受保护的快照 id' },
      unpin: { type: 'string', description: '要取消保护的快照 id' },
    },
    output: {
      schema: BACKUPS_SCHEMA,
      render: (_args, value) => {
        const view = value as { ok: boolean; message: string; backups?: readonly BackupView[]; next?: string }
        const lines = [view.message]
        for (const item of view.backups ?? []) {
          const flags = [
            item.protected ? '受保护' : '可清理',
            `kind=${item.kind}`,
            formatBytes(item.size),
            item.existed ? '文件存在' : '文件原本不存在',
          ].join('，')
          lines.push(`- ${item.id}（${flags}）`)
        }
        if (view.next !== undefined) lines.push(view.next)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)

      // Protection management requires a concrete file.
      const targetId = args.pin ?? args.unpin
      if (targetId !== undefined && targetId !== '') {
        if (args.filepath === undefined || args.filepath === '') {
          return { ok: false, message: 'pin / unpin 需要同时提供 filepath，用于定位该文件的快照目录' }
        }
        const absolute = await resolveInsideWorkspace(workspace, args.filepath)
        const wantProtected = args.pin !== undefined && args.pin !== ''
        const updated = await setProtection(workspace, absolute, targetId, wantProtected)
        if (updated === undefined) {
          const listed = await listBackups(workspace, absolute)
          return {
            ok: false,
            message: `未找到快照 ${targetId}，或该快照已经处于目标状态`,
            backups: listed.slice(0, 40).map(toView),
            next: '用不带 pin / unpin 的调用列出该文件的所有快照，再挑一个 id 重试。',
          }
        }
        const listed = await listBackups(workspace, absolute)
        return {
          ok: true,
          message: wantProtected ? `已保护 ${updated.id}：它不会被自动清理` : `已取消保护 ${updated.id}`,
          backups: listed.slice(0, 40).map(toView),
        }
      }

      const absolute = args.filepath === undefined || args.filepath === ''
        ? undefined
        : await resolveInsideWorkspace(workspace, args.filepath)

      const records = await listBackups(workspace, absolute)
      if (records.length === 0) {
        return {
          ok: true,
          message: absolute === undefined ? '还没有任何快照' : `${absolute} 没有快照记录`,
          backups: [],
        }
      }
      return {
        ok: true,
        message: `共 ${records.length} 条快照（最新在前）`,
        backups: records.slice(0, 40).map(toView),
      }
    },
  })
}

function toView(record: {
  readonly id: string
  readonly path: string
  readonly kind: string
  readonly createdAt: string
  readonly existed: boolean
  readonly protected: boolean
  readonly size: number
}): BackupView {
  return {
    id: record.id,
    path: record.path,
    kind: record.kind,
    createdAt: record.createdAt,
    existed: record.existed,
    protected: record.protected,
    size: record.size,
  }
}
