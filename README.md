# DeepSeek Harness 安全工具包

[English](README_EN.md) | 中文

给 dsh 补上「破坏性操作可逆、写入门禁、结构化返回」这三件事。7 个工具，外加一个可独立开关的治理插件。

## 风险提示：会绕过按工具名匹配的护栏

本插件用 `safe_edit` / `safe_write` / `multi_edit` 替代原生的 `edit` / `write`，治理层还会把原生工具从工具表里移除。

如果你的护栏插件是**按工具名**判断"这是不是写操作"，那么它盯着的 `write` / `edit` 在这里根本不会出现，而 `safe_*` 不在它的名单里——结果是**护栏被整体绕过**，模型改文件时不会弹任何审批。

这不是假设，而是任何未登记 `safe_*` 的按名护栏的必然结果。

### 三种处理方式

| 方式 | 做法 | 结果 |
| --- | --- | --- |
| 不共存 | 只装护栏，不装本插件 | 有审批，失去快照与回滚 |
| 护栏适配 | 确认护栏已覆盖 `safe_edit` / `safe_write` / `multi_edit` / `safe_rollback` / `test_runner` | 审批与回滚同时具备（推荐） |
| 兜底收紧 | 护栏设 `unknownTools: ask` | 未登记工具一律弹窗，噪音大但 fail-closed |

作者维护的另一款护栏 [write-approval-guard](https://github.com/SilverCrossing/write-approval-guard) 已完成适配，参数名对照如下，方便其他护栏作者复用：

| 工具 | 路径参数 |
| --- | --- |
| `safe_edit` / `safe_write` / `safe_rollback` | `filepath` |
| `multi_edit` | `edits[].file`（逐项判定，取最高风险） |
| `test_runner` | 无路径参数，按"执行项目代码"处理 |
| `syntax_check` / `safe_backups` | 只读或仅动备份元数据，无需拦截 |

### 自查

1. 看护栏的覆盖列表里有没有 `safe_edit` / `safe_write` / `multi_edit` / `safe_rollback`
2. 没有的话，三选一：升级护栏、设 `unknownTools: ask`、或不要同时安装
3. 装好后实测：让模型用 `safe_write` 新建一个文件，确认是否弹出审批

一句话：**本插件把"写"从原生工具名挪到了 `safe_*`，任何按名匹配的护栏都必须跟着挪。没挪，等于没有护栏。**

### 给护栏作者的接口

上面那张对照表同时是对外契约，机器可读。两种消费方式：

```ts
// 方式一：注入服务（运行时发现）
export const inject = ['safetyToolkit']
// ctx.safetyToolkit.contract.replacedTools  -> ['write', 'edit']
// ctx.safetyToolkit.contract.tools          -> [{ name, pathArgs, mutating, replaces? }]

// 方式二：子路径导入（构建期已知，适合写死映射）
import { TOOL_CONTRACT } from 'dsh-safety-toolkit/contract'
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `contractVersion` | 契约格式版本，仅在形状变化时递增 |
| `plugin` | 提供方包名 |
| `replacedTools` | 被从工具表移除的原生工具名 |
| `tools[].name` | 模型可见的工具名 |
| `tools[].pathArgs` | 路径参数；`edits[].file` 表示数组元素的字段；空数组表示无路径参数 |
| `tools[].mutating` | 是否会改文件、或执行项目代码 |
| `tools[].replaces` | 被替代的原生工具名 |
| `tools[].note` | 护栏可以跳过该工具的理由 |

契约服务是**尽力而为**的：注册失败只打一行警告，工具照常工作。所以护栏应当同时支持"服务不存在时退回静态映射"，而不是硬依赖它。

## 与弥亚工具箱的关系

设计思路参考了 AstrBot 平台的 [弥亚开发工具箱](https://github.com/irmia2026/irmia_devkit_open)（作者 伊尔弥亚，AGPL-3.0）：它把「改动前留快照 → 修改 → 校验 → 不通过就还原」做成了成套工具，这个范式值得学。

本项目是面向 DeepSeek Harness 的**独立实现**：不含弥亚工具箱的任何源码、文档或注释，快照布局、匹配消歧算法与返回结构均为自研；工具命名沿用其风格，只为迁移时便于对应。两者没有隶属关系，本项目也不是弥亚工具箱的官方移植版。

许可证也与其保持一致：**AGPL-3.0**。

弥亚那 60 多个工具里，大部分在 dsh 里已被 `bash` / `read` / `grep` / `lsp` / `web_fetch` 覆盖，照搬只会增加模型的选择负担。所以这里只补 dsh 真正缺的三类语义：

- **可逆**：`edit` / `write` 出错就是出错，dsh 没有快照与回滚
- **门禁**：写完立刻知道语法炸没炸，而不是等到构建时
- **结构化**：返回计数与建议，而不是让模型啃原始输出

## 工具

| 工具 | 作用 | 关键行为 |
| --- | --- | --- |
| `safe_edit` | 替代 `edit` | 改动前留快照、改动后校验、不通过则还原；支持 replace / 按行插入 / 按行删除 |
| `safe_write` | 替代 `write` | 目标已存在时默认拒绝（返回提案），需显式 `overwrite=true` |
| `multi_edit` | 跨文件原子编辑 | 全部在内存中应用并过门禁，全通过才落盘；任一失败零文件变更 |
| `safe_rollback` | 回滚 | 可反复回滚到同一版本；回滚前的状态另存为撤销点 |
| `safe_backups` | 查看与管理快照 | 干净 id；`pin` / `unpin` 控制是否受保护 |
| `syntax_check` | 只读语法门禁 | Python / JS / Go / JSON 真检查，TS / Rust 明确返回 skipped |
| `test_runner` | 跑测试 | 输出 passed / failed / skipped 计数，自动探测 pytest / go / cargo / npm |

## 快照与保留策略

### 存放位置

默认全局根：`~/.dsh/safety-backups`（Windows 为 `C:\Users\<你>\.dsh\safety-backups`），由 `DSH_SAFETY_BACKUP_DIR` 覆盖。**一个全局根对应一份 1GB 配额**，不是每个工作区各 1GB。

```
~/.dsh/safety-backups/
└── safe-edit.ts~a1b2c3d4~9f8e7d6c/          ← 一个源文件一个目录
    ├── source.json                          ← 记录原文件绝对路径
    ├── 20261021T190500123Z~edit.bak
    ├── 20261021T190512044Z~edit.bak
    └── 20261021T190530091Z~rollback.bak.keep
```

目录名三段：`<原文件名>~<工作区哈希8>~<相对路径哈希8>`。两个哈希保证不同工作区、不同目录下的同名文件不会互相覆盖，文件名保留可读性。目录权限 `0700`、文件 `0600`。

`kind=edit` 是改动前快照（`safe_rollback` 的默认目标）；`kind=rollback` 是回滚撤销点，必须显式指定 id 才会被选中。

### 清理规则

按优先级从强到弱：

```
受保护(.keep)  >  保护期(24h)  >  每文件份数  >  最大年龄  >  总量配额
```

- 受保护快照**永不自动删除**，哪怕配额已经超了
- 保护期内的快照一律不自动删，只能手动清理
- 清理**只在实际超限时**执行删除，没超限就只统计
- 清理在**写操作之前**运行，保证新快照一定写得下
- 任何异常都被吞掉，维护任务绝不影响编辑主流程

### 配额耗尽时会怎样

无法腾出空间时进入降级状态：

| 操作 | 降级时的行为 |
| --- | --- |
| `safe_edit` / `safe_write` / `multi_edit` | 拒绝，返回原因与处理建议 |
| `safe_rollback` | 仍然允许；撤销点降级为尽力而为，结果会说明"本次没有撤销点" |
| `safe_backups` / `syntax_check` / 只读操作 | 始终允许 |

拒绝理由是"当前工作不可回滚"，而不是"工具坏了"——宁可停下，也不留下一堆无法恢复的修改。恢复方式：`unpin` 取消某些保护、手动删除旧快照，或调大 `DSH_SAFETY_BACKUP_MAX_BYTES`。

### 参数

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `DSH_SAFETY_BACKUP_DIR` | `~/.dsh/safety-backups` | 相对路径按用户主目录解析，不按进程 cwd |
| `DSH_SAFETY_BACKUP_MAX_BYTES` | `1073741824`（1GB） | 全局总量上限，`0` 关闭 |
| `DSH_SAFETY_BACKUP_MAX_AGE_DAYS` | `14` | 超过即删，`0` 关闭 |
| `DSH_SAFETY_BACKUP_MIN_AGE_HOURS` | `24` | 保护期，此内一律不自动删 |
| `DSH_SAFETY_BACKUP_KEEP_PER_FILE` | `10` | 每个源文件保留份数 |
| `DSH_SAFETY_BACKUP_THROTTLE_MINUTES` | `5` | 正常状态下的清理间隔；降级状态不节流 |
| `DSH_SAFETY_BACKUP_MIN_FREE_MB` | `100` | 备份分区最低剩余空间，不足则拒绝写入 |

## 操作日志

每次调用本插件的 7 个工具都会写一条审计记录，用于事后追溯“谁在什么时候动了哪个文件”。

位置：`~/.dsh/log/YYYY-MM-DD.jsonl`（Windows 为 `C:\Users\<你>\.dsh\log`），按本地日期一天一个文件，一行一个 JSON：

```json
{"ts":"2026-10-24T20:38:06.127+08:00","tool":"safe_edit","ok":true,"paths":["/w/a.ts"],"backup":"20261024T200806127Z~edit.bak"}
{"ts":"2026-10-24T20:38:26.192+08:00","tool":"safe_write","ok":false,"paths":["/w/b.ts"],"detail":"语法门禁未通过，已回滚"}
```

| 字段 | 含义 |
| --- | --- |
| `ts` | 本地时间，带时区偏移 |
| `tool` | 工具名 |
| `ok` | 是否成功 |
| `paths` | 本次调用涉及的文件路径（`multi_edit` 会列出全部） |
| `backup` | 产生的快照 id，可直接用作 `safe_rollback` 的 `backup_name` |
| `detail` | 失败原因前 200 字符（**不含文件内容**） |

设计约束：

- **只记录本插件自己的工具**，不碰 `read` / `grep` / `bash` 等
- **不记录文件内容**，只有路径与结果
- 写入失败只警告，绝不影响工具调用
- 并发调用按发生顺序串行写入（队列，不是完成顺序）
- 超过保留期的文件自动删除（最多每 6 小时检查一次）；单日文件超过上限后停止追加

查询示例：

```powershell
# 今天这个文件被谁动过
Select-String C:\Users\<you>\.dsh\log\*.jsonl -Pattern 'a\.ts'
# 今天所有失败的操作
Get-Content C:\Users\<you>\.dsh\log\2026-10-24.jsonl | Select-String '"ok":false'
```

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `DSH_SAFETY_AUDIT` | 开启 | 设为 `off` 关闭日志 |
| `DSH_SAFETY_AUDIT_DIR` | `~/.dsh/log` | 日志根目录 |
| `DSH_SAFETY_AUDIT_DAYS` | `7` | 保留天数，`0` 表示不自动删 |
| `DSH_SAFETY_AUDIT_MAX_MB` | `10` | 单日文件上限，达到后当日停止记录 |

存储成本：单条约 300 字节，每天 100 次操作约 30 KB，7 天约 210 KB。相比 1 GB 的快照配额可以忽略。

## 治理插件（governance）

启用后做三件事：

1. **按实际部署探测 shell** 并生成提示词：有 `bash` 就点名 `cat >` / `tee` / `sed -i`，有 `pwsh` 就点名 `Set-Content` / `Out-File` / 重定向。
2. **作用域遮蔽**：在 `agent/created` 时为每个 agent 安装 `tools.restrict({ deny: ['write','edit'] })`，让这两个名字从工具表和提示词里消失。没有对应工具注册时自动跳过，避免 `unknown tool` 报错。
3. **全局单调守卫**兜底：`ctx.tools.guard()` 拒绝 `write` / `edit` 运行期调用。作用域限制不会向下继承给 subagent，只有全局守卫能一起覆盖。

注意：第 2 条会把原生工具名从工具表移除，任何按工具名匹配的护栏因此失效——详见上方[风险提示](#风险提示会绕过按工具名匹配的护栏)。

`bash` / `pwsh` **不做硬约束**，只做提示词软约束：shell 重定向写文件的方式，工具层守卫无法可靠检查，假装拦得住只是安全表演。

## 界面语言

插件管理页显示的标题与描述来自 `locale/`，跟随界面语言切换：

| 条目 | 中文 | English |
| --- | --- | --- |
| 工具包 | 安全工具包 | Safety Toolkit |
| 治理插件 | 写工具治理 | Write Governance |

改文案只需要编辑 `locale/*.json`，不需要重新构建（那是纯数据文件）。

要加第三种语言，复制一份 `locale/xx.json` 并填同样的 `meta.title` / `meta.description` 即可；`en.json` 必须保留，它是语言发现入口。

注意：这只影响**插件展示**。工具名、工具描述、返回给模型的错误信息是给模型读的，不随界面语言变化。

插件卡片图标由 `package.json` 顶层的 `"icon": "./icon.svg"` 提供；治理子插件通过 `"./governance/icon": "./icon.svg"` 共用同一张图。图片要求自包含、不超过 256 KiB，支持 SVG / PNG / JPEG / WebP。

## 安装

### 方式一：从 GitHub 安装

```sh
dsh plugin --profile my-profile add github:你的账号/dsh-safety-toolkit
```

`lib/` 构建产物随仓库提交，安装时不需要跑构建脚本，因此不会触发 pnpm 的 `allowBuilds` 授权要求。改完源码记得 `npm run build` 再提交。

唯一前提：私有仓库需要本机已有可用的 git 凭据（HTTPS token 或 SSH key）。

### 方式二：本地 checkout

```sh
dsh plugin --profile demo add /absolute/path/to/dsh-safety-toolkit
```

### 方式三：patch 覆盖层（改代码即时生效）

```sh
# 先把 cordis.yml 里的绝对路径改成本机实际路径
pnpm dsh web --patch ./cordis.yml
```

覆盖层直接加载 `src/*.ts`，不需要构建。

### 验证

```sh
dsh --profile my-profile --dump-config   # 应能看到 safety-toolkit 与 safety-governance 两层
```

只想用工具、不启用强制策略时，删掉 `cordis.patch.yml` 里的 `safety-governance` 那一行。

## 关于构建

`build` 用 `tsc --noCheck`，只做转译不做类型检查：安装环境里没有 `@deepseek-ai/*` 的类型声明，做类型检查会以非零退出码结束。

**刻意不声明 `prepare` 脚本**：只要 `package.json` 里存在 install 生命周期脚本，pnpm 就要求 `allowBuilds` 授权并报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`；而授权 key 带 commit hash，每次 push 都会失效。产物随仓库提交后，这条路彻底不需要了。

本地开发要装依赖再构建：

```sh
npm install --legacy-peer-deps
npm run build
```

真要做类型检查，在 dsh 源码 checkout 里跑 `npm run typecheck`。

## 已知限制

- **shell 是逃生门**：提示词会点名实际存在的 shell 与对应写法，但不硬拦。工具层无法可靠解析命令字符串。
- **subagent 不继承作用域限制**：所以治理层是双保险——主 agent 用 `restrict` 让 write/edit 消失，全局 `guard()` 把包括 subagent 在内的运行期调用拒掉。
- **TypeScript / Rust 不做语法检查**：需要项目级类型信息（`tsc --noEmit` / `cargo check`），本工具不代跑，跟部署里有没有 `lsp` 工具无关。
- **Python 解释器需要能真实执行**：门禁依次探测 `python3` / `python` / `py -3` 并跑一段真代码验证。Windows 上的应用执行别名占位符（退出码 9009）会被正确判为"检查器不可用"而非语法错误。可用 `DSH_SAFETY_PYTHON` 指定解释器。
- **只有非零退出的明确语法诊断才算错误**：检查器本身异常时返回 `skipped`，宁可放行也不误判。
- **敏感文件不做特殊处理**：`.env`、密钥文件同样按普通文件快照。如果不想让它们落盘，请自行调整 `DSH_SAFETY_BACKUP_DIR` 或不要用安全工具改这些文件。
- **`test_runner` 会执行项目代码**：它跑的是你项目的测试，权限等同于你在终端里手动执行同一条命令。不要让它在一个不可信的仓库里跑测试。

## 安全提醒

1. 快照里是**文件原文**，可能包含密钥、token、`.env` 内容。目录权限已设 `0700/0600`，但仍请**不要**把备份根放进版本库，也不要放进 OneDrive / Dropbox 这类同步目录。
2. 默认备份根在 `~/.dsh/` 下，不在工作区，所以 `git clean -fdx` 碰不到；一旦你把 `DSH_SAFETY_BACKUP_DIR` 指到工作区内，一次 `git clean -fdx` 就会连同快照一起删掉。
3. 受保护快照（`.keep`）永不自动删除，这是配额被吃满的唯一合法原因。满了会拒绝写入，需要手动处理。
4. 审计日志含**文件绝对路径**（不含内容）。虽然默认在 `~/.dsh/log/` 下，仍请不要放进版本库或云同步目录。

## 静态扫描会看到什么

用启发式扫描器扫这个仓库，会命中两类警告，它们都不是缺陷：

| 命中 | 为什么存在 |
| --- | --- |
| `process.env.*` 读取 | 配置入口：备份根、`DSH_HOME`、Python 解释器、配额参数 |
| `child_process.spawn` | 语法门禁要调 `python3` / `node` / `gofmt`，测试执行要调 `pytest` / `go` / `cargo` / `npm` |

本插件**不使用**网络（无 `http` / `https` / `net` / `dgram`），**不使用**动态执行（无 `eval` / `Function` / `vm`）。所有子进程调用都是「固定命令 + 参数数组」，不经过 shell，因此不存在命令拼接注入。

### 子进程如何解析

不把裸命令名交给系统，而是先按 `PATH` 解析成绝对路径再执行。原因：Windows 的 `SearchPathW` 搜索顺序**包含当前目录**，而进程 cwd 就是 agent 工作区——如果直接 `spawn('python3')`，模型可以在工作区放一个 `python3.exe`，让门禁去执行它（CWE-426，不受信任的搜索路径）。

实现上还做了两件事：`PATH` 里的空项被跳过（POSIX 中空项表示当前目录）；`DSH_SAFETY_PYTHON` 只接受绝对路径，相对值会被忽略并告警。

### 残留风险

子进程的可信度最终取决于 `PATH` 本身。如果你把当前目录或某个可写目录显式写进 `PATH`，上面那层防护就失效了——那是环境配置问题，工具无法代偿。

## 紧急恢复

这个插件会修改 dsh 的写入行为，所以必须能在"自己坏掉"时被绕过。三条路径，都不依赖插件自身：

1. **只关治理层**：删掉 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 里的 `safety-governance` 那一行，重启。工具还在，强制策略失效。
2. **整个插件下线**：`dsh plugin --profile <name> remove dsh-safety-toolkit`，重启。
3. **最坏情况**：直接编辑上面那个 `cordis.patch.yml`，或从 `$DSH_HOME/profiles/<name>` 的依赖目录里删掉本包。

Windows 上 `$DSH_HOME` 默认是 `C:\Users\<你>\.dsh`。

## 自举风险

插件运行在 dsh 内部，又修改 dsh 的行为，因此有三件事需要知道：

- **改源码不会立即生效**：模块已加载进内存，改动要重启才兑现。所以"模型改掉配额默认值"不是即时提权，而是**重启后生效的持久化后门**。
- **工作区隔离是第一道防线**：所有文件工具（含 `safe_edit`）都被限制在会话工作区内。插件源码在工作区外时，模型碰不到它。**开发插件时不要把插件目录作为 agent 的工作区。**
- **按文件名拦截只能提高成本**：用 guard 拒绝写 `retention.ts` 之类的文件，改个名就能绕过。真正可靠的边界是 OS 权限与目录隔离，不是工具层规则。

## 更新

git 依赖会锁定到具体 commit，所以更新不是自动的：

```sh
# 最稳：删掉重装，确保拉到最新
dsh plugin --profile <name> remove dsh-safety-toolkit
dsh plugin --profile <name> add github:SilverCrossing/dsh-safety-toolkit

# 或者先试 update（未必会重新解析 git commit）
dsh plugin --profile <name> update dsh-safety-toolkit
```

更新后**必须重启 dsh**（组合在启动时求值，热重载不覆盖组合包变化）。版本号可在 profile 目录的 `package.json` 里核对。

## 许可证

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。

这意味着：你可以自由使用、修改、分发本软件；但如果你分发修改后的版本，或把它作为网络服务提供给他人，必须同样以 AGPL-3.0 公开完整源代码。

第三方依赖及其许可证见各依赖包自身声明。
