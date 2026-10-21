/**
 * Pure text-edit engine shared by `safe_edit` and `multi_edit`.
 *
 * Every failure is structured: the caller gets a reason plus the closest line,
 * because a bare "no match" makes a model retry the same broken edit.
 */
export type EditSpec = {
    readonly mode: 'replace';
    readonly old: string;
    readonly new: string;
    readonly replaceAll?: boolean;
    readonly occurrence?: number;
} | {
    readonly mode: 'insert_at_line';
    readonly line: number;
    readonly new: string;
} | {
    readonly mode: 'delete_lines';
    readonly startLine: number;
    readonly endLine: number;
};
export type EditOutcome = {
    readonly ok: true;
    readonly content: string;
    readonly replaced: number;
} | {
    readonly ok: false;
    readonly reason: string;
    readonly closest?: string;
};
/** Nearest line of `content` to a multi-line `needle`, with a little context. */
export declare function closestSuggestion(content: string, needle: string): string | undefined;
/**
 * Apply one edit to a string.
 * @param content - current file content.
 * @param spec - edit description.
 */
export declare function applyEdit(content: string, spec: EditSpec): EditOutcome;
