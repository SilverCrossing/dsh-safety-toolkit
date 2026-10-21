/** Minimal child-process helper: buffered output, hard timeout, never throws on non-zero exit. */
export interface ProcessResult {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
}
export interface ProcessOptions {
    readonly cwd: string;
    readonly timeoutMs?: number;
    readonly input?: string;
    readonly maxOutput?: number;
}
/**
 * Run one command and capture its output.
 * @param command - executable name or absolute path.
 * @param args - argument vector, passed without a shell.
 * @returns Buffered result; a missing binary yields code 127.
 */
export declare function runProcess(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult>;
