/**
 * `test_runner` — turn raw test output into a counted verdict.
 *
 * Only frameworks this package can actually parse get a structured count.
 * Anything else still runs, but reports raw output instead of inventing numbers.
 */

import { join } from 'node:path'

import { exists } from '../lib/backup.js'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { runProcess } from '../lib/proc.js'
import { workspaceOf } from '../lib/workspace.js'

type Framework = 'pytest' | 'go' | 'cargo' | 'npm'

interface TestSummary {
  readonly ok: boolean
  readonly message: string
  readonly framework: string
  readonly passed?: number
  readonly failed?: number
  readonly skipped?: number
  readonly exitCode?: number
  readonly next?: string
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '测试是否全部通过' },
    message: { type: 'string', description: '一句话结果摘要' },
    framework: { type: 'string', description: '实际使用的测试框架，或探测结果' },
    passed: { type: 'integer', description: '通过数' },
    failed: { type: 'integer', description: '失败数' },
    skipped: { type: 'integer', description: '跳过数' },
    exitCode: { type: 'integer', description: '退出码' },
    next: { type: 'string', description: '失败摘要或下一步建议' },
  },
} as const

async function detect(workspace: string): Promise<Framework | undefined> {
  if (await exists(join(workspace, 'go.mod'))) return 'go'
  if (await exists(join(workspace, 'Cargo.toml'))) return 'cargo'
  if (await exists(join(workspace, 'pytest.ini'))) return 'pytest'
  if (await exists(join(workspace, 'pyproject.toml'))) return 'pytest'
  if (await exists(join(workspace, 'tests')) && (await exists(join(workspace, 'setup.py')) || await exists(join(workspace, 'requirements.txt')))) return 'pytest'
  if (await exists(join(workspace, 'package.json'))) return 'npm'
  return undefined
}

function commandFor(framework: Framework): { command: string; args: string[] } {
  switch (framework) {
    case 'pytest': return { command: 'python3', args: ['-m', 'pytest', '-q'] }
    case 'go': return { command: 'go', args: ['test', './...'] }
    case 'cargo': return { command: 'cargo', args: ['test'] }
    case 'npm': return { command: 'npm', args: ['test', '--silent'] }
  }
}

/** pytest: "===== 2 failed, 10 passed, 1 skipped in 0.42s =====" */
function parsePytest(output: string): { passed?: number; failed?: number; skipped?: number } {
  const counts: { passed?: number; failed?: number; skipped?: number } = {}
  const matches = output.matchAll(/(\d+) (passed|failed|skipped|error|errors)/g)
  for (const match of matches) {
    const value = Number(match[1])
    switch (match[2]) {
      case 'passed': counts.passed = value; break
      case 'failed':
      case 'error':
      case 'errors': counts.failed = (counts.failed ?? 0) + value; break
      case 'skipped': counts.skipped = value; break
    }
  }
  return counts
}

/** go: "--- FAIL: TestX" lines and "ok  pkg  0.01s" lines. */
function parseGo(output: string): { passed?: number; failed?: number } {
  const failed = [...output.matchAll(/--- FAIL: /g)].length
  const passed = [...output.matchAll(/--- PASS: /g)].length
  return { passed, failed }
}

export function testRunnerTool(ctx: Context) {
  return defineTool({
    name: 'test_runner',
    description: [
      '运行项目的测试并返回结构化结果（passed / failed / skipped），而不是原始输出。',
      '自动探测 pytest / go test / cargo test / npm test；无法解析计数的框架会返回退出码与输出尾部。',
    ].join(' '),
    parameters: {
      framework: {
        type: 'string',
        enum: ['auto', 'pytest', 'go', 'cargo', 'npm'],
        description: '测试框架，默认 auto 自动探测',
      },
      timeout_ms: { type: 'integer', description: '超时毫秒数，默认 300000（5 分钟）' },
    },
    output: {
      schema: SCHEMA,
      render: (_args, value) => {
        const summary = value as TestSummary
        const lines = [summary.message]
        const counts = [summary.passed, summary.failed, summary.skipped]
        if (counts.some(count => count !== undefined)) {
          lines.push(`通过 ${summary.passed ?? 0} / 失败 ${summary.failed ?? 0} / 跳过 ${summary.skipped ?? 0}`)
        }
        if (summary.next !== undefined) lines.push(summary.next)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const workspace = await workspaceOf(ctx, exec)
      const chosen: Framework | undefined = args.framework === undefined || args.framework === 'auto'
        ? await detect(workspace)
        : args.framework

      if (chosen === undefined) {
        return {
          ok: false,
          framework: 'unknown',
          message: '未能探测到测试框架',
          next: '请显式传 framework（pytest / go / cargo / npm），或确认工作区里有对应的项目文件。',
        }
      }

      const { command, args: argv } = commandFor(chosen as Framework)
      const result = await runProcess(command, argv, {
        cwd: workspace,
        timeoutMs: args.timeout_ms ?? 300_000,
      })

      if (result.code === 127) {
        return { ok: false, framework: chosen, message: `找不到可执行文件：${command}`, next: '请先安装该测试框架，或改用其他 framework。' }
      }
      if (result.timedOut) {
        return { ok: false, framework: chosen, message: `测试超时（${args.timeout_ms ?? 300_000} ms）`, next: '缩小测试范围或调大 timeout_ms。' }
      }

      const output = `${result.stdout}\n${result.stderr}`
      const summary: { passed?: number; failed?: number; skipped?: number } = chosen === 'pytest'
        ? parsePytest(output)
        : chosen === 'go'
          ? parseGo(output)
          : {}

      const tail = output.trim().split('\n').slice(-15).join('\n')
      const ok = result.code === 0
      return {
        ok,
        framework: chosen,
        message: ok ? `${chosen} 测试全部通过` : `${chosen} 测试失败（退出码 ${result.code ?? 'null'}）`,
        ...summary,
        ...(result.code === null ? {} : { exitCode: result.code }),
        ...(ok ? {} : { next: tail }),
      }
    },
  })
}
