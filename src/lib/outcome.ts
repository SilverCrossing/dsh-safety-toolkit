/** Shared response shape: structured, greppable, and explicit about what happened. */

export interface ToolOutcome {
  /** Whether the requested effect was achieved and kept. */
  readonly ok: boolean
  /** One-line human summary. */
  readonly message: string
  /** Files touched, with backup ids when a backup was written. */
  readonly files?: readonly FileOutcome[]
  /** Syntax gate verdicts collected before commit. */
  readonly syntax?: readonly SyntaxVerdict[]
  /** Actionable next step when ok is false. */
  readonly next?: string
}

export interface FileOutcome {
  readonly path: string
  readonly backupId?: string
  readonly changed: boolean
}

export interface SyntaxVerdict {
  readonly path: string
  readonly status: string
  readonly checker: string
  readonly detail?: string
}

/** Render an outcome as the single text block models consume. */
export function renderOutcome(outcome: ToolOutcome): string {
  const lines: string[] = [outcome.ok ? `成功：${outcome.message}` : `失败：${outcome.message}`]
  for (const file of outcome.files ?? []) {
    const backup = file.backupId === undefined ? '未备份' : `备份 ${file.backupId}`
    lines.push(`- ${file.path}（${file.changed ? '已修改' : '未变更'}，${backup}）`)
  }
  for (const verdict of outcome.syntax ?? []) {
    lines.push(`- 语法门禁 ${verdict.path}：${verdict.status}（${verdict.checker}）`)
    if (verdict.detail !== undefined && verdict.detail !== '') {
      lines.push(indent(verdict.detail))
    }
  }
  if (outcome.next !== undefined) lines.push(`下一步：${outcome.next}`)
  return lines.join('\n')
}

function indent(text: string): string {
  return text.split('\n').map(line => `    ${line}`).join('\n')
}

/** Standard output schema for every tool in this toolkit. */
export const OUTCOME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '是否成功' },
    message: { type: 'string', description: '一句话结果摘要' },
    files: {
      type: 'array',
      description: '涉及的文件',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          backupId: { type: 'string' },
          changed: { type: 'boolean' },
        },
      },
    },
    syntax: {
      type: 'array',
      description: '语法门禁结果',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          status: { type: 'string' },
          checker: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    next: { type: 'string', description: '失败时的可执行建议' },
  },
} as const
