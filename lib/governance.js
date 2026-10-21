/**
 * Safety governance plugin.
 *
 * Two jobs, both deliberately weak-mechanism:
 *  1. A global monotonic guard denies the built-in `write` / `edit` and points
 *     at the safe replacements. Guards cannot be overridden by later listeners,
 *     and being global it also covers subagents, which do not inherit scoped
 *     tool restrictions.
 *  2. A prompt section states the soft rule for `bash`, which this plugin does
 *     NOT hard-block: shell redirection can write files in ways a tool-level
 *     guard cannot reliably inspect.
 */
export const name = 'safety-governance';
export const inject = ['tools', 'systemPrompt'];
/** Prompt section order. Sits after the identity sections and before tool guidance tails. */
const SECTION_ORDER = 900;
const REPLACEMENTS = {
    write: 'safe_write',
    edit: 'safe_edit',
};
const GUIDANCE = [
    '[安全编辑策略]',
    '- 新建或整体覆盖文件用 safe_write；局部修改用 safe_edit；需要跨文件同时改且不允许中间破损用 multi_edit。',
    '- 这三个工具会在改动前落盘快照、改动后校验语法，校验不通过则自动还原。',
    '- 内置 write 与 edit 已被策略禁用，调用会被直接拒绝，不要尝试。',
    '- 需要恢复时用 safe_backups 查看版本、safe_rollback 回滚。',
    '- bash 没有被硬性限制：构建、测试、查看、临时文件都可以用。但不要用 bash 写仓库文件（cat > / tee / sed -i），那样会绕过备份与语法门禁，出错后无法回滚。',
].join('\n');
export function apply(ctx) {
    const services = ctx;
    services.tools.guard((exec) => {
        const replacement = REPLACEMENTS[exec.name];
        if (replacement === undefined)
            return undefined;
        return `工具 ${exec.name} 已被安全策略禁用：它会直接覆盖文件且不留快照。请改用 ${replacement}，它会在改动前落盘快照、改动后校验语法，校验不通过则还原。`;
    });
    services.systemPrompt.section({
        name: 'safety:file-writes',
        order: SECTION_ORDER,
        text: () => GUIDANCE,
    });
}
