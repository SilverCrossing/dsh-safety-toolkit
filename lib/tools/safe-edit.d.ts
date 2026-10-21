/**
 * `safe_edit` — the replacement for the built-in `edit`.
 *
 * Differences from `edit`: the previous content is always backed up first, the
 * new content passes a syntax gate before the change is kept, and a failed gate
 * restores the file so the workspace is never left broken.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function safeEditTool(ctx: Context): any;
