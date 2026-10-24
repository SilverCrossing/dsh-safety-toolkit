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
/** Test hook: forget resolved executables. */
export declare function resetExecutableCache(): void;
/**
 * Resolve a command to an absolute path using `PATH` only.
 *
 * Deliberately never consults the working directory, and never falls back to a
 * bare name: an unresolvable command reports 127 instead of letting the OS
 * search somewhere we did not intend.
 */
export declare function resolveExecutable(command: string): Promise<string | undefined>;
/**
 * Run one command and capture its output.
 * @param command - executable name (resolved via PATH) or absolute path.
 * @param args - argument vector, passed without a shell.
 * @returns Buffered result; an unresolvable command yields code 127.
 */
export declare function runProcess(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult>;
