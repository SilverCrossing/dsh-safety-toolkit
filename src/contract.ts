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
  readonly name: string
  /**
   * Argument fields that carry a filesystem target, in dotted/bracket form
   * (for example `edits[].file`). Empty when the tool takes no path.
   */
  readonly pathArgs: readonly string[]
  /** True when the call can change files or run project code. */
  readonly mutating: boolean
  /** Built-in tool this one replaces, when it is a replacement. */
  readonly replaces?: string
  /** Why a guard may skip this tool, when it is safe to skip. */
  readonly note?: string
}

export interface ToolContract {
  /** Format version of this contract. Bump only on breaking shape changes. */
  readonly contractVersion: 1
  readonly plugin: string
  /** Built-in tool names this package removes from the tool list. */
  readonly replacedTools: readonly string[]
  readonly tools: readonly ToolContractEntry[]
}

export const TOOL_CONTRACT: ToolContract = {
  contractVersion: 1,
  plugin: 'dsh-safety-toolkit',
  replacedTools: ['write', 'edit'],
  tools: [
    { name: 'safe_edit', pathArgs: ['filepath'], mutating: true, replaces: 'edit' },
    { name: 'safe_write', pathArgs: ['filepath'], mutating: true, replaces: 'write' },
    { name: 'multi_edit', pathArgs: ['edits[].file'], mutating: true },
    { name: 'safe_rollback', pathArgs: ['filepath'], mutating: true },
    { name: 'safe_backups', pathArgs: ['filepath'], mutating: false, note: '只读查询；pin/unpin 只改快照文件名的保护后缀' },
    { name: 'syntax_check', pathArgs: ['filepath'], mutating: false, note: '只读检查' },
    { name: 'test_runner', pathArgs: [], mutating: true, note: '无路径参数；会执行项目测试代码' },
  ],
}
