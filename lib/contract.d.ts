/**
 * Machine-readable tool contract.
 *
 * Any guard plugin that decides "is this a write?" by tool name needs to know
 * which names this package provides, which built-in names it replaces, and
 * where each tool carries its target path. Publishing that as data beats asking
 * every guard author to hard-code the list again.
 *
 * Consume it two ways:
 *   - import { TOOL_CONTRACT } from 'dsh-safety-toolkit/contract'
 *   - inject the `safetyToolkit` service and read `.contract`
 */
export interface ToolContractEntry {
    /** Model-facing tool name. */
    readonly name: string;
    /**
     * Argument fields that carry a filesystem target, in dotted/bracket form
     * (for example `edits[].file`). Empty when the tool takes no path.
     */
    readonly pathArgs: readonly string[];
    /** True when the call can change files or run project code. */
    readonly mutating: boolean;
    /** Built-in tool this one replaces, when it is a replacement. */
    readonly replaces?: string;
    /** Why a guard may skip this tool, when it is safe to skip. */
    readonly note?: string;
}
export interface ToolContract {
    /** Format version of this contract. Bump only on breaking shape changes. */
    readonly contractVersion: 1;
    readonly plugin: string;
    /** Built-in tool names this package removes from the tool list. */
    readonly replacedTools: readonly string[];
    readonly tools: readonly ToolContractEntry[];
}
export declare const TOOL_CONTRACT: ToolContract;
