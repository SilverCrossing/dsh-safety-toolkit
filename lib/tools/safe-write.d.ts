/**
 * `safe_write` — the replacement for the built-in `write`.
 *
 * Never silently clobbers: an existing file is a proposal, not a write, unless
 * `overwrite` is explicitly true. Successful writes keep a backup and pass the
 * syntax gate; a failed gate restores the previous state (or deletes the file
 * when it did not exist before).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function safeWriteTool(ctx: Context): any;
