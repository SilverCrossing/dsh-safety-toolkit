/** Minimal child-process helper: buffered output, hard timeout, never throws on non-zero exit. */

import { spawn } from 'node:child_process'

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

/**
 * Run one command and capture its output.
 * @param command - executable name or absolute path.
 * @param args - argument vector, passed without a shell.
 * @returns Buffered result; a missing binary yields code 127.
 */
export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  const { cwd, timeoutMs = 60_000, input, maxOutput = 200_000 } = options
  return await new Promise<ProcessResult>((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(command, [...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
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
