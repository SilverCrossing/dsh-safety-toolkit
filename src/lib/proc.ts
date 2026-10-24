/**
 * Child-process helper with explicit executable resolution.
 *
 * Why we do not hand a bare command name to `spawn`: on Windows the lookup goes
 * through `SearchPathW`, whose order includes the *current directory*. Since the
 * process cwd is the agent workspace, a model could plant `python3.exe` there
 * and have our own syntax gate execute it (CWE-426, untrusted search path).
 *
 * So we resolve against `PATH` ourselves and pass an absolute path. Empty `PATH`
 * entries are skipped too — on POSIX an empty entry means "current directory".
 */

import { spawn } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

export interface ProcessResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface ProcessOptions {
  readonly cwd: string
  readonly timeoutMs?: number
  readonly input?: string
  readonly maxOutput?: number
}

const isWindows = process.platform === 'win32'

const PATHEXT: readonly string[] = isWindows
  ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(ext => ext.trim() !== '')
  : ['']

/** Command name → resolved absolute path, or null when it is not on PATH. */
const resolvedCache = new Map<string, string | null>()

/** Test hook: forget resolved executables. */
export function resetExecutableCache(): void {
  resolvedCache.clear()
}

function candidatesFor(command: string): readonly string[] {
  if (!isWindows) return [command]
  const lower = command.toLowerCase()
  if (PATHEXT.some(ext => lower.endsWith(ext.toLowerCase()))) return [command]
  return PATHEXT.map(ext => `${command}${ext}`)
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const info = await stat(candidate)
    if (!info.isFile()) return false
    if (isWindows) return true
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a command to an absolute path using `PATH` only.
 *
 * Deliberately never consults the working directory, and never falls back to a
 * bare name: an unresolvable command reports 127 instead of letting the OS
 * search somewhere we did not intend.
 */
export async function resolveExecutable(command: string): Promise<string | undefined> {
  if (isAbsolute(command)) {
    return await isExecutableFile(command) ? command : undefined
  }

  const cached = resolvedCache.get(command)
  if (cached !== undefined) return cached ?? undefined

  const searchPath = process.env.PATH ?? ''
  const found = await (async (): Promise<string | undefined> => {
    for (const directory of searchPath.split(delimiter)) {
      // An empty entry means "current directory" on POSIX; never honour it.
      if (directory === '') continue
      for (const candidate of candidatesFor(command)) {
        const full = join(directory, candidate)
        if (await isExecutableFile(full)) return full
      }
    }
    return undefined
  })()

  resolvedCache.set(command, found ?? null)
  return found
}

/**
 * Run one command and capture its output.
 * @param command - executable name (resolved via PATH) or absolute path.
 * @param args - argument vector, passed without a shell.
 * @returns Buffered result; an unresolvable command yields code 127.
 */
export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  const { cwd, timeoutMs = 60_000, input, maxOutput = 200_000 } = options

  const executable = await resolveExecutable(command)
  if (executable === undefined) {
    return {
      code: 127,
      signal: null,
      stdout: '',
      stderr: `未能在 PATH 中找到可执行文件：${command}`,
      timedOut: false,
    }
  }

  return await new Promise<ProcessResult>((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(executable, [...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        code,
        signal,
        stdout: stdout.slice(0, maxOutput),
        stderr: stderr.slice(0, maxOutput),
        timedOut,
      })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error: Error) => {
      stderr += `${error.message}\n`
      finish(127, null)
    })
    child.on('close', (code, signal) => { finish(code, signal) })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}
