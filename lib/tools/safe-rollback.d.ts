/**
 * `safe_rollback` — restore a previous snapshot of one file.
 *
 * Rollbacks are repeatable: the backup being read stays on disk, and the state
 * replaced by the rollback is snapshotted, so the operation is itself undoable.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function safeRollbackTool(ctx: Context): any;
