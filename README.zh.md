# DeepSeek Harness 安全工具包

给 dsh 补上「破坏性操作可逆、写入门禁、结构化返回」这三件事。一期 7 个工具，外加一个可独立开关的治理插件。

## 与弥亚工具箱的关系

设计思路参考了 AstrBot 平台的 [弥亚开发工具箱](https://github.com/irmia2026/irmia_devkit_open)（作者 伊尔弥亚，AGPL-3.0）：它把「改动前留快照 → 修改 → 校验 → 不通过就还原」做成了成套工具，这个范式值得学。

本项目是面向 DeepSeek Harness 的**独立实现**：不含弥亚工具箱的任何源码、文档或注释，备份布局、匹配消歧算法与返回结构均为自研；工具命名沿用其风格，只为迁移时便于对应。两者没有隶属关系，本项目也不是弥亚工具箱的官方移植版。

弥亚那 60 多个工具里，大部分在 dsh 里已被 `bash` / `read` / `grep` / `lsp` / `web_fetch` 覆盖，照搬只会增加模型的选择负担。所以这里只补 dsh 真正缺的三类语义：

- **可逆**：`edit` / `write` 出错就是出错，dsh 没有备份与回滚
- **门禁**：写完立刻知道语法炸没炸，而不是等到构建时
- **结构化**：返回计数与建议，而不是让模型啃原始输出

## 工具

| 工具 | 作用 | 关键行为 |
| --- | --- | --- |
| `safe_edit` | 替代 `edit` | 改动前留快照、改动后校验、不通过则还原；支持 replace / 按行插入 / 按行删除 |
| `safe_write` | 替代 `write` | 目标已存在时默认拒绝（返回提案），需显式 `overwrite=true` |
| `multi_edit` | 跨文件原子编辑 | 全部在内存中应用并过门禁，全通过才落盘；任一失败零文件变更 |
| `safe_rollback` | 回滚 | 不指定备份时回滚到最近一次 |
| `safe_backups` | 查看备份 | 可按文件过滤 |
| `syntax_check` | 只读语法门禁 | Python / JS / Go / JSON 真检查，TS / Rust 明确返回 skipped |
| `test_runner` | 跑测试 | 输出 passed / failed / skipped 计数，自动探测 pytest / go / cargo / npm |

备份位置：`<workspace>/.dsh-backups/<编码后的路径>/<时间戳>-<随机>.bak`，`.new` 后缀表示"改动前文件不存在"，回滚时会删掉文件而不是写空内容。

## 治理插件（governance）

启用后会做两件事：

1. **全局 `ctx.tools.guard()`** 单调拒绝 `write` 与 `edit`，并提示改用 `safe_write` / `safe_edit`。用全局 guard 而不是作用域 `restrict`，是因为 subagent 不继承作用域限制，只有全局守卫能一起兜住。
2. **注入提示词段落**，约束 `bash` 的用法：

```
[安全编辑策略]
- 新建或整体覆盖文件用 safe_write；局部修改用 safe_edit；...
- bash 没有被硬性限制：构建、测试、查看、临时文件都可以用。但不要用 bash 写仓库文件。
```

## 安装

### 方式一：从 GitHub 安装（推荐，便于更新）

```sh
dsh plugin --profile my-profile add github:你的账号/dsh-safety-toolkit
```

git 安装拉的是**源码**，包里的 `prepare` 脚本会用 `tsc` 现场构建出 `lib/`，所以 `lib/` 不进版本库（见 `.gitignore`）。

两个常见坎：

- pnpm ≥10 默认拒绝执行 git 依赖的构建脚本，首次 `add` 会失败并打印一个包键，把它原样复制进该 profile 的 `pnpm-workspace.yaml` 后再执行一次。
- 私有仓库需要本机已有可用的 git 凭据（HTTPS token 或 SSH key），否则 clone 会失败。

### 方式二：本地 checkout

```sh
dsh plugin --profile demo add /absolute/path/to/dsh-safety-toolkit
```

### 方式三：patch 覆盖层（改代码即时生效）

```sh
# 先把 cordis.yml 里的绝对路径改成本机实际路径
pnpm dsh web --patch ./cordis.yml
```

覆盖层直接加载 `src/*.ts`，不需要构建，适合开发时反复试。

### 验证

```sh
dsh --profile my-profile --dump-config   # 应能看到 safety-toolkit 与 safety-governance 两层
```

只想用工具、不启用强制策略时，删掉 `cordis.patch.yml` 里的 `safety-governance` 那一行。

### 关于构建

`build` 与 `prepare` 都用 `tsc --noCheck`，只做转译不做类型检查。原因是安装时宿主环境里没有 `@deepseek-ai/*` 的类型声明，一旦做类型检查，`tsc` 会以非零退出码结束，导致 `prepare` 失败、整包装不上。

真要做类型检查，在 dsh 源码 checkout 里跑：

```sh
npm run typecheck
```

## 已知限制

- **`bash` 是逃生门**：`cat >`、`tee`、`sed -i` 都能绕过备份与门禁。本包不假装能拦住它们，只做提示词软约束。要真拦住只能 deny `bash`，代价是砍掉大量能力。
- **subagent 不继承作用域限制**：术语表明确"带作用域的注册不会向下继承给 subagent"。所以治理层选择全局 guard；如果将来加 `restrict`，记得它只对主 agent 生效。
- **TypeScript / Rust 不做语法检查**：需要项目级类型信息，交给 `lsp` 工具。门禁宁可不表态，也不假装通过。
- **备份会污染仓库**：请把 `.dsh-backups/` 加进 `.gitignore`。

## 安全边界

- 所有路径都相对 **agent 工作目录** 解析，越界直接拒绝（`WorkspaceBoundaryError`），符号链接会解析到最深的已存在祖先再判断。
- 工作目录来自执行上下文（`ctx.workingDirectory.ensure(agent, signal)`），**不接受工具参数传根目录**，避免模型自己重定义边界。
- 每次写入都产生备份；备份写入失败则中止本次操作，不落一个"无法回滚"的修改。
