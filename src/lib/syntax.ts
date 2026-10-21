/**
 * Best-effort syntax gate.
 *
 * Two rules keep this gate trustworthy:
 *  1. A green result always means a checker actually ran and passed.
 *  2. "Checker unavailable" must never be reported as "syntax error" — on
 *     Windows, `python3` is often an App Execution Alias that exits 9009 when
 *     the real interpreter is missing, and treating that as a syntax failure
 *     would roll back every valid write.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { runProcess } from './proc.js'

export type SyntaxStatus = 'ok' | 'error' | 'skipped'

export interface SyntaxResult {
  readonly status: SyntaxStatus
  /** Language identifier derived from the extension. */
  readonly language: string
  /** Actionable output tail when status is `error`. */
  readonly detail?: string
  /** Checker that produced the verdict, or why none ran. */
  readonly checker: string
}

const LANGUAGES: Record<string, string> = {
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.go': 'go',
  '.json': 'json',
  '.rs': 'rust',
}

/** Exit codes that mean "no usable checker", never "bad syntax". */
const UNAVAILABLE_CODES: ReadonlySet<number> = new Set([
  127, // POSIX: command not found
  9009, // Windows: App Execution Alias stub / command not recognized
])

export function detectLanguage(filePath: string): string {
  return LANGUAGES[extname(filePath).toLowerCase()] ?? 'unknown'
}

/** Diagnostics that positively identify a Python syntax problem. */
const PYTHON_SYNTAX_ERRORS = /SyntaxError|IndentationError|TabError/

/**
 * Checker output keeps the actionable line at the end (a Python traceback ends
 * with the SyntaxError, `node --check` ends with the offending line), so trim
 * from the top instead of the bottom.
 */
function errorTail(text: string, lines = 12): string {
  const all = text.trimEnd().split('\n').filter(line => line.trim() !== '')
  return all.slice(-lines).join('\n')
}

interface PythonCandidate {
  readonly command: string
  readonly args: readonly string[]
}

const PYTHON_CANDIDATES: readonly PythonCandidate[] = [
  { command: 'python3', args: [] },
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
]

const PROBE_MARKER = 'DSH_SAFETY_PY_OK'
const PROBE_SCRIPT = `print(${JSON.stringify(PROBE_MARKER)})`

let pythonProbe: Promise<PythonCandidate | undefined> | undefined

/**
 * Find a Python interpreter that actually executes code.
 *
 * A `--version` check is not enough: the Windows alias exits 9009 without
 * printing anything useful, and some shims print a banner while failing. So the
 * probe runs real code and requires both exit 0 and the marker on stdout.
 * Set `DSH_SAFETY_PYTHON` to pin an absolute interpreter path.
 */
async function probePython(cwd: string): Promise<PythonCandidate | undefined> {
  pythonProbe ??= (async () => {
    const override = process.env.DSH_SAFETY_PYTHON
    const candidates: readonly PythonCandidate[] = override !== undefined && override.trim() !== ''
      ? [{ command: override.trim(), args: [] }]
      : PYTHON_CANDIDATES
    for (const candidate of candidates) {
      const probe = await runProcess(candidate.command, [...candidate.args, '-c', PROBE_SCRIPT], {
        cwd,
        timeoutMs: 15_000,
      })
      if (probe.code === 0 && probe.stdout.includes(PROBE_MARKER)) return candidate
    }
    return undefined
  })()
  return await pythonProbe
}

/** Reset the cached interpreter probe (used by tests). */
export function resetPythonProbe(): void {
  pythonProbe = undefined
}

/**
 * Run the available syntax checker for one file.
 * @param cwd - working directory for the checker process.
 * @param filePath - absolute path of the file to check.
 */
export async function checkSyntax(cwd: string, filePath: string): Promise<SyntaxResult> {
  const language = detectLanguage(filePath)

  if (language === 'json') {
    const text = await readFile(filePath, 'utf8')
    try {
      JSON.parse(text)
      return { status: 'ok', language, checker: 'JSON.parse' }
    } catch (error) {
      return { status: 'error', language, checker: 'JSON.parse', detail: (error as Error).message }
    }
  }

  if (language === 'python') {
    const python = await probePython(cwd)
    if (python === undefined) {
      return {
        status: 'skipped',
        language,
        checker: '未找到可用的 Python 解释器（尝试过 python3 / python / py；可用环境变量 DSH_SAFETY_PYTHON 指定绝对路径）',
      }
    }
    const script = 'import pathlib,sys;compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),sys.argv[1],"exec")'
    const checker = `${python.command} -c compile`
    const result = await runProcess(python.command, [...python.args, '-c', script, filePath], {
      cwd,
      timeoutMs: 20_000,
    })
    if (result.code === 0) return { status: 'ok', language, checker }
    if (UNAVAILABLE_CODES.has(result.code ?? -1)) {
      return { status: 'skipped', language, checker: `${python.command} 执行失败（退出码 ${result.code ?? '未知'}），视为检查器不可用` }
    }
    // Only an explicit syntax diagnostic may block a write. Any other non-zero
    // exit means the checker itself is unhappy (shim, missing file, broken
    // interpreter), and "cannot judge" must never be reported as "invalid".
    const detail = errorTail(result.stderr)
    if (PYTHON_SYNTAX_ERRORS.test(detail)) {
      return { status: 'error', language, checker, detail }
    }
    return {
      status: 'skipped',
      language,
      checker: `${python.command} 运行异常（退出码 ${result.code ?? '未知'}），无法判定语法`,
      ...(detail === '' ? {} : { detail }),
    }
  }

  if (language === 'javascript') {
    const result = await runProcess('node', ['--check', filePath], { cwd, timeoutMs: 20_000 })
    if (result.code === 0) return { status: 'ok', language, checker: 'node --check' }
    if (UNAVAILABLE_CODES.has(result.code ?? -1)) {
      return { status: 'skipped', language, checker: 'node 不可用' }
    }
    return { status: 'error', language, checker: 'node --check', detail: errorTail(result.stderr) }
  }

  if (language === 'go') {
    const result = await runProcess('gofmt', ['-e', '-l', filePath], { cwd, timeoutMs: 20_000 })
    if (result.code === 0) return { status: 'ok', language, checker: 'gofmt -e' }
    if (UNAVAILABLE_CODES.has(result.code ?? -1)) {
      return { status: 'skipped', language, checker: 'gofmt 不可用' }
    }
    return { status: 'error', language, checker: 'gofmt -e', detail: errorTail(result.stderr) }
  }

  if (language === 'typescript' || language === 'rust') {
    return {
      status: 'skipped',
      language,
      checker: '需要项目级类型检查（TypeScript 用 tsc --noEmit，Rust 用 cargo check），本工具不代跑',
    }
  }

  return { status: 'skipped', language, checker: '未知文件类型，没有对应的语法检查器' }
}
