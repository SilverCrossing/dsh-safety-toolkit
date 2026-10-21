/**
 * Best-effort syntax gate.
 *
 * The gate never guesses: a language without a locally available checker is
 * reported as `skipped`, so a green result always means "a checker actually ran
 * and passed". Type checking is intentionally out of scope here and stays with
 * the `lsp` tool.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { runProcess } from './proc.js';
const LANGUAGES = {
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
};
export function detectLanguage(filePath) {
    return LANGUAGES[extname(filePath).toLowerCase()] ?? 'unknown';
}
/**
 * Checker output keeps the actionable line at the end (a Python traceback ends
 * with the SyntaxError, `node --check` ends with the offending line), so trim
 * from the top instead of the bottom.
 */
function errorTail(text, lines = 12) {
    const all = text.trimEnd().split('\n').filter(line => line.trim() !== '');
    return all.slice(-lines).join('\n');
}
/**
 * Run the available syntax checker for one file.
 * @param cwd - working directory for the checker process.
 * @param filePath - absolute path of the file to check.
 */
export async function checkSyntax(cwd, filePath) {
    const language = detectLanguage(filePath);
    if (language === 'json') {
        const text = await readFile(filePath, 'utf8');
        try {
            JSON.parse(text);
            return { status: 'ok', language, checker: 'JSON.parse' };
        }
        catch (error) {
            return { status: 'error', language, checker: 'JSON.parse', detail: error.message };
        }
    }
    if (language === 'python') {
        const script = 'import pathlib,sys;compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),sys.argv[1],"exec")';
        const result = await runProcess('python3', ['-c', script, filePath], { cwd, timeoutMs: 20_000 });
        if (result.code === 0)
            return { status: 'ok', language, checker: 'python3 -m compile' };
        if (result.code === 127)
            return { status: 'skipped', language, checker: 'python3 不可用' };
        return { status: 'error', language, checker: 'python3 -m compile', detail: errorTail(result.stderr) };
    }
    if (language === 'javascript') {
        const result = await runProcess('node', ['--check', filePath], { cwd, timeoutMs: 20_000 });
        if (result.code === 0)
            return { status: 'ok', language, checker: 'node --check' };
        if (result.code === 127)
            return { status: 'skipped', language, checker: 'node 不可用' };
        return { status: 'error', language, checker: 'node --check', detail: errorTail(result.stderr) };
    }
    if (language === 'go') {
        const result = await runProcess('gofmt', ['-e', '-l', filePath], { cwd, timeoutMs: 20_000 });
        if (result.code === 0)
            return { status: 'ok', language, checker: 'gofmt -e' };
        if (result.code === 127)
            return { status: 'skipped', language, checker: 'gofmt 不可用' };
        return { status: 'error', language, checker: 'gofmt -e', detail: errorTail(result.stderr) };
    }
    // TypeScript and Rust need a project context (tsconfig / Cargo.toml) that this
    // gate does not own, so it declines instead of pretending to pass.
    return { status: 'skipped', language, checker: '该语言需要项目级类型检查，请使用 lsp 工具' };
}
