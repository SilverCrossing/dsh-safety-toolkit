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
export type SyntaxStatus = 'ok' | 'error' | 'skipped';
export interface SyntaxResult {
    readonly status: SyntaxStatus;
    /** Language identifier derived from the extension. */
    readonly language: string;
    /** Actionable output tail when status is `error`. */
    readonly detail?: string;
    /** Checker that produced the verdict, or why none ran. */
    readonly checker: string;
}
export declare function detectLanguage(filePath: string): string;
/** Reset the cached interpreter probe (used by tests). */
export declare function resetPythonProbe(): void;
/**
 * Run the available syntax checker for one file.
 * @param cwd - working directory for the checker process.
 * @param filePath - absolute path of the file to check.
 */
export declare function checkSyntax(cwd: string, filePath: string): Promise<SyntaxResult>;
