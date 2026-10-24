/**
 * Append-only audit trail for the toolkit's own tool calls.
 *
 * Layout: `<root>/<YYYY-MM-DD>.jsonl` — one flat file per local day, one JSON
 * per line. Flat beats per-day folders here: fewer inodes, one file to grep,
 * and the whole week fits in a single `Select-String`.
 *
 * Goals, in order:
 *  1. Answer "who touched this file, when, and with what result" after the fact.
 *  2. Never break a tool call. Every write is best-effort and swallowed.
 *  3. Stay small: one line per call, daily rotation, hard per-file cap.
 *
 * It deliberately records no file contents — only paths, outcome and a short
 * reason. Contents already live in snapshots; duplicating them here would make
 * the log both larger and more sensitive for no diagnostic gain.
 */
export interface AuditPolicy {
    readonly enabled: boolean;
    readonly root: string;
    readonly retentionDays: number;
    /** Stop appending once one day's file reaches this size. */
    readonly maxFileBytes: number;
}
export interface AuditEntry {
    /** Local ISO timestamp with offset, e.g. 2026-10-24T20:36:12.345+08:00 */
    readonly ts: string;
    readonly tool: string;
    readonly ok: boolean;
    /** Target paths extracted from the call arguments. */
    readonly paths: readonly string[];
    /** Snapshot id when the call produced one. */
    readonly backup?: string;
    /** Short failure reason; never file content. */
    readonly detail?: string;
}
/** Audit root — a flat `log` directory beside the snapshot root. */
export declare function auditRoot(): string;
export declare function loadAuditPolicy(env?: NodeJS.ProcessEnv): AuditPolicy;
/** Local-time ISO with offset — readable without conversion. */
export declare function localIso(date: Date): string;
/** Local date used as the file name, e.g. `2026-10-24`. */
export declare function dayOf(date: Date): string;
/** Test hooks. */
export declare function resetAuditState(): void;
/** Remove day files older than the retention window. Best effort. */
export declare function pruneAudit(policy: AuditPolicy, now?: number): Promise<number>;
/**
 * Append one entry. Never throws: a broken audit trail must not break the tool
 * call it is describing. Concurrent calls are queued, so lines keep the order
 * the calls actually happened in.
 */
export declare function appendAudit(entry: AuditEntry, policy?: AuditPolicy): Promise<void>;
/** Extract string values addressed by a contract path such as `edits[].file`. */
export declare function extractPaths(args: unknown, path: string): string[];
