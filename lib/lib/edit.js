/**
 * Pure text-edit engine shared by `safe_edit` and `multi_edit`.
 *
 * Every failure is structured: the caller gets a reason plus the closest line,
 * because a bare "no match" makes a model retry the same broken edit.
 */
function splitLines(content) {
    return content.split('\n');
}
/** Normalize trailing whitespace per line so a tab/space mismatch does not defeat matching. */
function normalize(text) {
    return text.split('\n').map(line => line.replace(/\s+$/, '')).join('\n').trim();
}
function similarity(a, b) {
    const left = normalize(a);
    const right = normalize(b);
    if (left === '' || right === '')
        return 0;
    if (left === right)
        return 1;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    let hits = 0;
    for (let index = 0; index < shorter.length; index += 1) {
        if (longer.includes(shorter.slice(index, index + 12)))
            hits += 1;
    }
    const ratio = hits / Math.max(1, shorter.length - 11);
    return Math.min(0.99, ratio * (shorter.length / longer.length) ** 0.25);
}
/** Nearest line of `content` to a multi-line `needle`, with a little context. */
export function closestSuggestion(content, needle) {
    const lines = splitLines(content);
    const needleLines = splitLines(needle);
    const head = needleLines[0] ?? '';
    let best = -1;
    let bestScore = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const score = similarity(lines[index] ?? '', head);
        if (score > bestScore) {
            bestScore = score;
            best = index;
        }
    }
    if (best < 0 || bestScore < 0.3)
        return undefined;
    const from = Math.max(0, best - 2);
    const to = Math.min(lines.length, best + needleLines.length + 2);
    return lines.slice(from, to).map((line, offset) => `${from + offset + 1}| ${line}`).join('\n');
}
/**
 * Apply one edit to a string.
 * @param content - current file content.
 * @param spec - edit description.
 */
export function applyEdit(content, spec) {
    if (spec.mode === 'insert_at_line') {
        if (!Number.isInteger(spec.line) || spec.line < 0) {
            return { ok: false, reason: 'line 必须是非负整数（0 表示插入到文件开头）' };
        }
        const lines = splitLines(content);
        if (spec.line > lines.length) {
            return { ok: false, reason: `line=${spec.line} 超出文件范围（共 ${lines.length} 行）` };
        }
        const insert = splitLines(spec.new);
        lines.splice(spec.line, 0, ...insert);
        return { ok: true, content: lines.join('\n'), replaced: 1 };
    }
    if (spec.mode === 'delete_lines') {
        const lines = splitLines(content);
        if (!Number.isInteger(spec.startLine) || !Number.isInteger(spec.endLine)) {
            return { ok: false, reason: 'start_line 与 end_line 必须是整数' };
        }
        if (spec.startLine < 1 || spec.endLine < spec.startLine || spec.endLine > lines.length) {
            return { ok: false, reason: `行号区间 ${spec.startLine}~${spec.endLine} 非法（共 ${lines.length} 行）` };
        }
        lines.splice(spec.startLine - 1, spec.endLine - spec.startLine + 1);
        return { ok: true, content: lines.join('\n'), replaced: 1 };
    }
    if (spec.old === '')
        return { ok: false, reason: 'old 不能为空字符串' };
    if (spec.old === spec.new)
        return { ok: false, reason: 'old 与 new 相同，没有产生任何改动' };
    const occurrences = content.split(spec.old).length - 1;
    if (occurrences === 0) {
        return {
            ok: false,
            reason: '未找到匹配的 old 文本（精确匹配，包含缩进）',
            closest: closestSuggestion(content, spec.old),
        };
    }
    if (spec.replaceAll === true) {
        return { ok: true, content: content.split(spec.old).join(spec.new), replaced: occurrences };
    }
    const occurrence = spec.occurrence ?? 0;
    if (occurrence > 0) {
        if (occurrence > occurrences) {
            return { ok: false, reason: `occurrence=${occurrence} 超出匹配次数（共 ${occurrences} 处）` };
        }
        let seen = 0;
        let cursor = 0;
        for (;;) {
            const index = content.indexOf(spec.old, cursor);
            if (index < 0)
                return { ok: false, reason: '内部匹配失败' };
            seen += 1;
            if (seen === occurrence) {
                const next = content.slice(0, index) + spec.new + content.slice(index + spec.old.length);
                return { ok: true, content: next, replaced: 1 };
            }
            cursor = index + spec.old.length;
        }
    }
    if (occurrences > 1) {
        const lines = splitLines(content);
        const positions = [];
        let cursor = 0;
        let hit = content.indexOf(spec.old);
        while (hit >= 0 && positions.length < 8) {
            const lineNumber = content.slice(0, hit).split('\n').length;
            positions.push(`${lineNumber}| ${lines[lineNumber - 1]?.slice(0, 120) ?? ''}`);
            cursor = hit + spec.old.length;
            hit = content.indexOf(spec.old, cursor);
        }
        return {
            ok: false,
            reason: `old 在文件中有 ${occurrences} 处匹配，需要消歧：请扩大上下文，或传 occurrence=N（第 N 处）/ replace_all=true`,
            closest: positions.join('\n'),
        };
    }
    const index = content.indexOf(spec.old);
    return { ok: true, content: content.slice(0, index) + spec.new + content.slice(index + spec.old.length), replaced: 1 };
}
