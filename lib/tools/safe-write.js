/**
 * `safe_write` — the replacement for the built-in `write`.
 *
 * Never silently clobbers: an existing file is a proposal, not a write, unless
 * `overwrite` is explicitly true. Successful writes keep a backup and pass the
 * syntax gate; a failed gate restores the previous state (or deletes the file
 * when it did not exist before).
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createBackup, exists } from '../lib/backup.js';
import { OUTCOME_SCHEMA, renderOutcome } from '../lib/outcome.js';
import { resolveInsideWorkspace } from '../lib/paths.js';
import { checkSyntax } from '../lib/syntax.js';
import { workspaceOf } from '../lib/workspace.js';
export function safeWriteTool(ctx) {
    return defineTool({
        name: 'safe_write',
        description: [
            '写入文件：写入前落盘快照，写入后校验语法，校验不通过则还原（原本不存在的文件会被删除）。',
            '用于替代内置 write。目标已存在时必须显式传 overwrite=true 才覆盖，否则只返回提案供确认。',
        ].join(' '),
        parameters: {
            filepath: { type: 'string', required: true, description: '目标文件路径，绝对路径或相对工作区路径' },
            content: { type: 'string', required: true, description: '要写入的完整内容' },
            overwrite: { type: 'boolean', description: '允许覆盖已存在的文件，默认 false' },
            syntax_check: { type: 'boolean', description: '是否跑语法门禁，默认 true' },
        },
        output: {
            schema: OUTCOME_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
        },
        async execute(args, exec) {
            const workspace = await workspaceOf(ctx, exec);
            const absolute = await resolveInsideWorkspace(workspace, args.filepath);
            const present = await exists(absolute);
            const previous = present ? await readFile(absolute, 'utf8') : null;
            if (present && args.overwrite !== true) {
                return {
                    ok: false,
                    message: `目标文件已存在（${previous?.length ?? 0} 字符），未写入`,
                    next: '局部修改请用 safe_edit；确认要整体覆盖时传 overwrite=true。',
                };
            }
            if (previous === args.content) {
                return { ok: true, message: '内容与现有文件一致，未做改动', files: [{ path: absolute, changed: false }] };
            }
            const backup = await createBackup(workspace, absolute, previous);
            await writeFile(absolute, args.content, 'utf8');
            const gate = args.syntax_check === false ? undefined : await checkSyntax(workspace, absolute);
            if (gate !== undefined && gate.status === 'error') {
                if (previous === null)
                    await rm(absolute, { force: true });
                else
                    await writeFile(absolute, previous, 'utf8');
                return {
                    ok: false,
                    message: `语法门禁未通过，已回滚：${gate.detail ?? ''}`.trim(),
                    files: [{ path: absolute, backupId: backup.id, changed: false }],
                    syntax: [{ path: absolute, status: gate.status, checker: gate.checker, ...(gate.detail === undefined ? {} : { detail: gate.detail }) }],
                    next: '修正内容后重试，或传 syntax_check=false 跳过门禁。',
                };
            }
            return {
                ok: true,
                message: previous === null ? '新文件已创建并保留备份' : '文件已覆盖并保留备份',
                files: [{ path: absolute, backupId: backup.id, changed: true }],
                ...(gate === undefined ? {} : { syntax: [{ path: absolute, status: gate.status, checker: gate.checker, ...(gate.detail === undefined ? {} : { detail: gate.detail }) }] }),
            };
        },
    });
}
