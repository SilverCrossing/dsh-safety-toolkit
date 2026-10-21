/** `syntax_check` — run the available syntax gate without modifying anything. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { OUTCOME_SCHEMA, renderOutcome, type SyntaxVerdict, type ToolOutcome } from '../lib/outcome.js'
import { resolveInsideWorkspace } from '../lib/paths.js'
import { checkSyntax } from '../lib/syntax.js'
import { workspaceOf } from '../lib/workspace.js'

export function syntaxCheckTool(ctx: Context) {
  return defineTool({
    name: 'syntax_check',
    description: [
      '对一个或多个文件跑语法门禁，不修改任何内容。',
      '支持 Python / JavaScript / Go / JSON；TypeScript 与 Rust 因需要项目级类型信息会返回 skipped，请改用 lsp 工具。',
    ].join(' '),
    parameters: {
      filepath: { type: 'string', required: true, description: '要检查的文件路径' },
    },
    output: {
      schema: OUTCOME_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value as ToolOutcome) }],
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)
      const absolute = await resolveInsideWorkspace(workspace, args.filepath)
      const gate = await checkSyntax(workspace, absolute)
      const verdict: SyntaxVerdict = {
        path: absolute,
        status: gate.status,
        checker: gate.checker,
        ...(gate.detail === undefined ? {} : { detail: gate.detail }),
      }

      if (gate.status === 'error') {
        return {
          ok: false,
          message: `${absolute} 语法检查未通过`,
          syntax: [verdict],
          next: '按上面的错误信息修正后重试。',
        }
      }

      return {
        ok: true,
        message: gate.status === 'ok' ? `${absolute} 语法检查通过` : `${absolute} 跳过检查（${gate.checker}）`,
        syntax: [verdict],
      }
    },
  })
}
