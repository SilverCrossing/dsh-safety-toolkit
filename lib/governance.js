/**
 * Safety governance plugin.
 *
 * Three jobs, ordered from weakest to strongest mechanism:
 *  1. A prompt section that states the soft rule for the shell tool actually
 *     present in this deployment (`bash` or `pwsh`, not a hard-coded name).
 *  2. Per-agent `tools.restrict({ deny })` so `write` / `edit` leave the tool
 *     list and the prompt entirely — the model cannot "fall back" to a name it
 *     never sees.
 *  3. A global monotonic guard as the floor. Guards cannot be overridden by
 *     later listeners, and unlike scoped restrictions they also cover
 *     subagents, which do not inherit scoped registrations.
 *
 * The shell is intentionally NOT hard-blocked: redirection writes files in ways
 * a tool-level guard cannot reliably inspect, and pretending otherwise would be
 * security theater.
 */
export const name = 'safety-governance';
export const inject = ['tools', 'systemPrompt', 'agents'];
/** Prompt section order: after identity sections, before tool-guidance tails. */
const SECTION_ORDER = 900;
const DENIED = ['write', 'edit'];
const REPLACEMENTS = {
    write: 'safe_write',
    edit: 'safe_edit',
};
/** Name the shell tools this deployment actually exposes. */
function shellGuidance(services) {
    const present = [];
    const bypass = [];
    if (services.tools.get('bash') !== undefined) {
        present.push('bash');
        bypass.push('cat > / tee / sed -i');
    }
    if (services.tools.get('pwsh') !== undefined) {
        present.push('pwsh');
        bypass.push('Set-Content / Out-File / 重定向追加');
    }
    if (present.length === 0) {
        return '- 本部署没有 shell 工具。';
    }
    return `- ${present.join(' 与 ')} 没有被硬性限制：构建、测试、查看、临时文件都可以用。但不要用它们写仓库文件（${bypass.join('；')}），那样会绕过快照与语法门禁，出错后无法回滚。`;
}
function buildGuidance(services) {
    return [
        '[安全编辑策略]',
        '- 新建或整体覆盖文件用 safe_write；局部修改用 safe_edit；需要跨文件同时改且不允许中间破损用 multi_edit。',
        '- 这三个工具会在改动前落盘快照、改动后校验语法，校验不通过则自动还原。',
        '- 主 agent 的工具表里已经没有内置 write 与 edit；subagent 不会被移除（作用域限制不向下继承），但调用同样会被拒绝。',
        '- 快照会按保留策略自动清理旧版本，重要版本可用 safe_backups 的 pin 标记为受保护。',
        '- 需要恢复时用 safe_backups 查看快照、safe_rollback 回滚（可反复回滚，也可撤销回滚）。',
        shellGuidance(services),
    ].join('\n');
}
/**
 * Deny the built-in write tools for one agent scope.
 *
 * `restrict` throws for names that are not registered globals, so the deny list
 * is filtered by presence first — a profile without `tool-fs` must not break
 * agent creation.
 */
function installRestriction(services, agent) {
    try {
        agent.ctx.inject(['tools'], (scope) => {
            const deny = DENIED.filter(name => services.tools.get(name) !== undefined);
            if (deny.length === 0)
                return;
            scope.tools.restrict({ deny });
        });
    }
    catch (error) {
        // Degrade to the global guard rather than failing agent creation.
        console.warn(`[safety-governance] 作用域限制安装失败，已降级为全局守卫：${error.message}`);
    }
}
export function apply(ctx) {
    const services = ctx;
    // 1. Soft rule for the shell that actually exists here.
    services.systemPrompt.section({
        name: 'safety:file-writes',
        order: SECTION_ORDER,
        text: () => buildGuidance(services),
    });
    // 2. Make write/edit invisible to existing and future agents.
    for (const agent of services.agents.list())
        installRestriction(services, agent);
    ctx.on('agent/created', (payload) => {
        installRestriction(services, payload.agent);
    });
    // 3. Floor for every agent, including subagents.
    services.tools.guard((exec) => {
        const replacement = REPLACEMENTS[exec.name];
        if (replacement === undefined)
            return undefined;
        return `工具 ${exec.name} 已被安全策略禁用：它会直接覆盖文件且不留快照。请改用 ${replacement}，它会在改动前落盘快照、改动后校验语法，校验不通过则还原。`;
    });
}
