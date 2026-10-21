/**
 * `test_runner` — turn raw test output into a counted verdict.
 *
 * Only frameworks this package can actually parse get a structured count.
 * Anything else still runs, but reports raw output instead of inventing numbers.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare function testRunnerTool(ctx: Context): any;
