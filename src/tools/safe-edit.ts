/**
 * `safe_edit` — the replacement for the built-in `edit`.
 *
 * Differences from `edit`: the previous content is always backed up first, the
 * new content passes a syntax gate before the change is kept, and a failed gate
 * restores the file so the workspace is never left broken.
 */

import { readFile, writeFile } from 'node:fs/promises'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { createBackup } from '../lib/backup.js'
import { backupRoot } from '../lib/layout.js'
import { ensureCapacity, loadPolicy } from '../lib/retention.js'
import { applyEdit } from '../lib/edit.js'
import { OUTCOME_SCHEMA, renderOutcome, type SyntaxVerdict, type ToolOutcome } from '../lib/outcome.js'
import { resolveInsideWorkspace } from '../lib/paths.js'
import { checkSyntax } from '../lib/syntax.js'
import { workspaceOf } from '../lib/workspace.js'

export function safeEditTool(ctx: Context) {
  return defineTool({
    name: 'safe_edit',
    description: [
      '编辑已有文件：改动前落盘快照，改动后校验语法，校验不通过则还原到改动前状态。',
      '用于替代内置 edit。支持三种模式：replace（精确文本替换）/ insert_at_line（按行插入）/ delete_lines（按行删除）。',
      'old 需精确匹配（含缩进）；命中多处时用 occurrence=N 或 replace_all=true 指明目标。',
    ].join(' '),
    parameters: {
      filepath: { type: 'string', required: true, description: '要编辑的文件路径，绝对路径或相对工作区路径' },
      mode: {
        type: 'string',
        enum: ['replace', 'insert_at_line', 'delete_lines'],
        description: '编辑模式，默认 replace',
      },
      old: { type: 'string', description: '要被替换的旧文本，精确匹配（mode=replace 时必填）' },
      new: { type: 'string', description: '替换后的新文本（mode=replace/insert_at_line 时必填）' },
      replace_all: { type: 'boolean', description: '替换全部匹配，默认 false' },
      occurrence: { type: 'integer', description: '替换第 N 处匹配（1-based），默认 0 表示要求唯一匹配' },
      line: { type: 'integer', description: 'mode=insert_at_line 时在此行之后插入，0 表示文件开头' },
      start_line: { type: 'integer', description: 'mode=delete_lines 的起始行（1-based，闭区间）' },
      end_line: { type: 'integer', description: 'mode=delete_lines 的结束行（1-based，闭区间）' },
      syntax_check: { type: 'boolean', description: '是否跑语法门禁，默认 true；设为 false 会跳过校验但仍备份' },
    },
    output: {
      schema: OUTCOME_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value as ToolOutcome) }],
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)
      const absolute = await resolveInsideWorkspace(workspace, args.filepath)

      let original: string
      try {
        original = await readFile(absolute, 'utf8')
      } catch {
        return {
          ok: false,
          message: `文件不存在或无法读取：${absolute}`,
          next: '新建文件请改用 safe_write；路径确认后再重试。',
        }
      }

      const mode = args.mode ?? 'replace'
      const outcome = applyEdit(original, mode === 'replace'
        ? {
            mode: 'replace',
            old: args.old ?? '',
            new: args.new ?? '',
            ...(args.replace_all !== undefined ? { replaceAll: args.replace_all } : {}),
            ...(args.occurrence !== undefined ? { occurrence: args.occurrence } : {}),
          }
        : mode === 'insert_at_line'
          ? { mode: 'insert_at_line', line: args.line ?? 0, new: args.new ?? '' }
          : { mode: 'delete_lines', startLine: args.start_line ?? 0, endLine: args.end_line ?? 0 })

      if (!outcome.ok) {
        return {
          ok: false,
          message: outcome.reason,
          ...(outcome.closest === undefined ? {} : { next: `最接近的内容如下，请据此修正 old：\n${outcome.closest}` }),
        }
      }

      if (outcome.content === original) {
        return { ok: true, message: '内容与原文件一致，未做改动', files: [{ path: absolute, changed: false }] }
      }

      const capacity = await ensureCapacity(backupRoot(), Buffer.byteLength(original, 'utf8'), loadPolicy())
      if (!capacity.ok) {
        return {
          ok: false,
          message: `已拒绝写入：${capacity.detail ?? '备份空间不足'}`,
          next: capacity.advice ?? '请清理备份空间后重试。',
        }
      }

      const backup = await createBackup(workspace, absolute, original)
      const files = [{ path: absolute, backupId: backup.id, changed: true }]
      await writeFile(absolute, outcome.content, 'utf8')

      const gate = args.syntax_check === false ? undefined : await checkSyntax(workspace, absolute)
      if (gate !== undefined && gate.status === 'error') {
        await writeFile(absolute, original, 'utf8')
        return {
          ok: false,
          message: `语法门禁未通过，已回滚到修改前内容：${gate.detail ?? ''}`.trim(),
          files: [{ path: absolute, backupId: backup.id, changed: false }],
          syntax: [toVerdict(absolute, gate)],
          next: '修正语法后重试；如果旧内容本身就不合法，可传 syntax_check=false 跳过门禁。',
        }
      }

      return {
        ok: true,
        message: `已替换 ${outcome.replaced} 处并保留备份`,
        files,
        ...(gate === undefined ? {} : { syntax: [toVerdict(absolute, gate)] }),
      }
    },
  })
}

function toVerdict(path: string, gate: { status: string; checker: string; detail?: string }): SyntaxVerdict {
  return {
    path,
    status: gate.status,
    checker: gate.checker,
    ...(gate.detail === undefined ? {} : { detail: gate.detail }),
  }
}
