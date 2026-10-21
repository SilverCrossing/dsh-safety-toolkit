/**
 * `multi_edit` — atomic cross-file edits.
 *
 * All edits are applied in memory first. Files are written only after every
 * edit resolves and every syntax gate passes, so a broken edit cannot leave
 * half the workspace changed.
 */

import { readFile, writeFile } from 'node:fs/promises'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { createBackup } from '../lib/backup.js'
import { backupRoot } from '../lib/layout.js'
import { ensureCapacity, loadPolicy } from '../lib/retention.js'
import { applyEdit } from '../lib/edit.js'
import { OUTCOME_SCHEMA, renderOutcome, type FileOutcome, type SyntaxVerdict, type ToolOutcome } from '../lib/outcome.js'
import { resolveInsideWorkspace } from '../lib/paths.js'
import { checkSyntax } from '../lib/syntax.js'
import { workspaceOf } from '../lib/workspace.js'

interface EditRequest {
  readonly file: string
  readonly old: string
  readonly new: string
  readonly replace_all?: boolean
  readonly occurrence?: number
}

export function multiEditTool(ctx: Context) {
  return defineTool({
    name: 'multi_edit',
    description: [
      '跨文件原子编辑：所有编辑先在内存中应用，全部成功且语法门禁全通过后才统一落盘，任一失败则一个文件都不改。',
      '适合一次重构里需要同步修改多处、且不允许出现中间破损状态的场景。',
    ].join(' '),
    parameters: {
      edits: {
        type: 'array',
        required: true,
        description: '编辑列表，按顺序应用',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string', description: '文件路径，绝对或相对工作区' },
            old: { type: 'string', description: '要替换的旧文本，精确匹配' },
            new: { type: 'string', description: '替换后的新文本' },
            replace_all: { type: 'boolean', description: '替换全部匹配' },
            occurrence: { type: 'integer', description: '替换第 N 处匹配（1-based）' },
          },
        },
      },
      syntax_check: { type: 'boolean', description: '是否跑语法门禁，默认 true' },
    },
    output: {
      schema: OUTCOME_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value as ToolOutcome) }],
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)
      const requests = args.edits as readonly EditRequest[]
      if (requests.length === 0) return { ok: false, message: 'edits 为空，没有可执行的编辑' }

      // Stage everything in memory, keyed by absolute path.
      const staged = new Map<string, string>()
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index]!
        const absolute = await resolveInsideWorkspace(workspace, request.file)
        let content = staged.get(absolute)
        if (content === undefined) {
          try {
            content = await readFile(absolute, 'utf8')
          } catch {
            return { ok: false, message: `第 ${index + 1} 项：文件不存在或无法读取 ${absolute}`, next: '确认路径，或先用 safe_write 创建文件。' }
          }
        }
        const outcome = applyEdit(content, {
          mode: 'replace',
          old: request.old,
          new: request.new,
          ...(request.replace_all !== undefined ? { replaceAll: request.replace_all } : {}),
          ...(request.occurrence !== undefined ? { occurrence: request.occurrence } : {}),
        })
        if (!outcome.ok) {
          return {
            ok: false,
            message: `第 ${index + 1} 项（${absolute}）失败：${outcome.reason}`,
            next: outcome.closest === undefined
              ? '修正该条编辑后重新提交整批，已提交的部分不会落盘。'
              : `最接近的内容：\n${outcome.closest}`,
          }
        }
        staged.set(absolute, outcome.content)
      }

      // Originals for rollback and backup.
      const originals = new Map<string, string>()
      for (const absolute of staged.keys()) originals.set(absolute, await readFile(absolute, 'utf8'))

      const verdicts: SyntaxVerdict[] = []
      if (args.syntax_check !== false) {
        for (const absolute of staged.keys()) {
          const gate = await checkSyntax(workspace, absolute)
          verdicts.push({ path: absolute, status: gate.status, checker: gate.checker, ...(gate.detail === undefined ? {} : { detail: gate.detail }) })
          if (gate.status === 'error') {
            return {
              ok: false,
              message: `语法门禁未通过，整批已取消：${absolute}`,
              syntax: verdicts,
              next: '修正后重新提交整批，没有任何文件被修改。',
            }
          }
        }
      }

      const required = [...originals.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0)
      const capacity = await ensureCapacity(backupRoot(), required, loadPolicy())
      if (!capacity.ok) {
        return {
          ok: false,
          message: `已拒绝写入：${capacity.detail ?? '备份空间不足'}`,
          next: capacity.advice ?? '请清理备份空间后重试。',
        }
      }

      const files: FileOutcome[] = []
      const written: string[] = []
      try {
        for (const [absolute, content] of staged) {
          const backup = await createBackup(workspace, absolute, originals.get(absolute) ?? null)
          await writeFile(absolute, content, 'utf8')
          written.push(absolute)
          files.push({ path: absolute, backupId: backup.id, changed: true })
        }
      } catch (error) {
        for (const absolute of written) {
          const original = originals.get(absolute)
          if (original !== undefined) await writeFile(absolute, original, 'utf8')
        }
        return {
          ok: false,
          message: `写入过程失败，已回滚已写文件：${(error as Error).message}`,
          files,
          next: '检查磁盘权限与剩余空间后重试。',
        }
      }

      return {
        ok: true,
        message: `已原子提交 ${files.length} 个文件`,
        files,
        ...(verdicts.length === 0 ? {} : { syntax: verdicts }),
      }
    },
  })
}
