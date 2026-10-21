/**
 * `multi_edit` — atomic cross-file edits.
 *
 * All edits are applied in memory first. Files are written only after every
 * edit resolves and every syntax gate passes, so a broken edit cannot leave
 * half the workspace changed.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function multiEditTool(ctx: Context): any;
