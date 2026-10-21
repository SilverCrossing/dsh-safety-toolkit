/**
 * Best-effort syntax gate.
 *
 * The gate never guesses: a language without a locally available checker is
 * reported as `skipped`, so a green result always means "a checker actually ran
 * and passed". Type checking is intentionally out of scope here and stays with
 * the `lsp` tool.
 */
export type SyntaxStatus = 'ok' | 'error' | 'skipped';
export interface SyntaxResult {
    readonly status: SyntaxStatus;
    /** Language identifier derived from the extension. */
    readonly language: string;
    /** First lines of checker output when status is `error`. */
    readonly detail?: string;
    /** Checker that produced the verdict, or why none ran. */
    readonly checker: string;
}
export declare function detectLanguage(filePath: string): string;
/**
 * Run the available syntax checker for one file.
 * @param cwd - working directory for the checker process.
 * @param filePath - absolute path of the file to check.
 */
export declare function checkSyntax(cwd: string, filePath: string): Promise<SyntaxResult>;
