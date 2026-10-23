# DeepSeek Harness Safety Toolkit

English | [中文](README.md)

Adds the three things DeepSeek Harness (dsh) lacks for file work: **reversible destructive edits, a write gate, and structured results**. Seven tools plus an independently toggleable governance plugin.

## Warning: this bypasses name-matched guards

This plugin replaces the built-in `edit` / `write` with `safe_edit` / `safe_write` / `multi_edit`, and its governance layer removes the built-in tools from the tool list entirely.

If your guard plugin decides "is this a write?" **by tool name**, the names it watches for never appear here, and `safe_*` is not on its list. The result is that **the guard is bypassed wholesale** — the model can change files without a single approval prompt.

That is not a hypothetical; it is the guaranteed outcome for any name-matched guard that has not registered `safe_*`.

### Three ways to handle it

| Approach | What to do | Trade-off |
| --- | --- | --- |
| Don't combine | Install the guard only | You get approvals, you lose snapshots and rollback |
| Adapt the guard | Make sure it covers `safe_edit` / `safe_write` / `multi_edit` / `safe_rollback` / `test_runner` | Approvals and rollback together (recommended) |
| Tighten the fallback | Set `unknownTools: ask` in the guard | Every unregistered tool prompts; noisy but fail-closed |

The author's companion guard [write-approval-guard](https://github.com/SilverCrossing/write-approval-guard) already covers these names. The argument mapping, for other guard authors:

| Tool | Path argument |
| --- | --- |
| `safe_edit` / `safe_write` / `safe_rollback` | `filepath` |
| `multi_edit` | `edits[].file` (per item, highest risk wins) |
| `test_runner` | no path argument; treat as "running project code" |
| `syntax_check` / `safe_backups` | read-only, or metadata only; no interception needed |

### Self-check

1. Look for `safe_edit` / `safe_write` / `multi_edit` / `safe_rollback` in the guard's coverage list
2. If missing: upgrade the guard, set `unknownTools: ask`, or do not install both
3. After installing, verify: have the model create a file with `safe_write` and confirm an approval prompt appears

In one line: **this plugin moves "writing" from the built-in tool names to `safe_*`, so every name-matched guard must move with it. If it doesn't, you have no guard.**

### Interface for guard authors

The mapping table above is also a machine-readable contract. Two ways to consume it:

```ts
// Option 1: inject the service (runtime discovery)
export const inject = ['safetyToolkit']
// ctx.safetyToolkit.contract.replacedTools  -> ['write', 'edit']
// ctx.safetyToolkit.contract.tools          -> [{ name, pathArgs, mutating, replaces? }]

// Option 2: subpath import (known at build time, for hard-coded maps)
import { TOOL_CONTRACT } from 'dsh-safety-toolkit/contract'
```

Fields:

| Field | Meaning |
| --- | --- |
| `contractVersion` | Contract format version; bumped only on shape changes |
| `plugin` | Providing package name |
| `replacedTools` | Built-in tool names removed from the tool list |
| `tools[].name` | Model-facing tool name |
| `tools[].pathArgs` | Path arguments; `edits[].file` means a field inside array elements; empty means no path |
| `tools[].mutating` | Whether the call can change files or run project code |
| `tools[].replaces` | Built-in tool this one replaces |
| `tools[].note` | Why a guard may skip this tool |

The contract service is **best-effort**: a failed registration logs one warning and the tools keep working. Guards should therefore fall back to a static map when the service is absent, rather than depending on it.

## Relationship to Irmia DevKit

The design is inspired by [Irmia DevKit](https://github.com/irmia2026/irmia_devkit_open) (by 伊尔弥亚, AGPL-3.0) for the AstrBot platform, which turned "snapshot before change → edit → verify → restore on failure" into a coherent tool family.

This project is an **independent implementation** for DeepSeek Harness. It contains none of Irmia's source code, documentation, or comments. The snapshot layout, edit-matching heuristics, and result shapes are original. Tool names follow its naming style only so that migrating between the two is easy to reason about. The two projects are unrelated; this is not an official port.

The license matches too: **AGPL-3.0**.

Most of Irmia's 60+ tools are already covered in dsh by `bash`, `read`, `grep`, `lsp`, and `web_fetch`; copying them wholesale would only add noise to the model's tool selection. This package fills the three semantics dsh actually misses:

- **Reversibility** — with `edit` / `write`, a mistake is simply a mistake; there is no snapshot and no rollback
- **Gating** — you find out syntax is broken immediately, not at build time
- **Structure** — counts and next steps, instead of raw output for the model to parse

## Tools

| Tool | Replaces | Behavior |
| --- | --- | --- |
| `safe_edit` | `edit` | Snapshot before, verify after, restore on failure; supports replace / insert-by-line / delete-by-line |
| `safe_write` | `write` | Refuses to clobber an existing file unless `overwrite=true` |
| `multi_edit` | — | Cross-file atomic edit: all changes staged in memory, written only if every gate passes |
| `safe_rollback` | — | Repeatable rollback to the same version; the replaced state becomes an undo point |
| `safe_backups` | — | Clean snapshot ids; `pin` / `unpin` control automatic cleanup |
| `syntax_check` | — | Real checks for Python / JS / Go / JSON; TS / Rust return `skipped` on purpose |
| `test_runner` | — | Structured passed / failed / skipped counts; auto-detects pytest / go / cargo / npm |

## Snapshots and retention

### Location

Global root: `~/.dsh/safety-backups`, overridable with `DSH_SAFETY_BACKUP_DIR`. **One root, one 1GB quota** — not 1GB per workspace.

```
~/.dsh/safety-backups/
└── safe-edit.ts~a1b2c3d4~9f8e7d6c/          ← one directory per source file
    ├── source.json                          ← records the original absolute path
    ├── 20261021T190500123Z~edit.bak
    ├── 20261021T190512044Z~edit.bak
    └── 20261021T190530091Z~rollback.bak.keep
```

Directory names are `<basename>~<workspaceHash8>~<relativePathHash8>`. The two hashes keep same-named files from different workspaces or directories apart, while the basename keeps the tree browsable. Directories are `0700`, files are `0600`.

`kind=edit` snapshots are the default rollback targets; `kind=rollback` snapshots are undo points and are only used when named explicitly.

### Cleanup precedence

```
protected (.keep)  >  protection window (24h)  >  keep-per-file  >  max age  >  max bytes
```

- Protected snapshots are **never removed automatically**, even when the quota is exceeded
- Snapshots inside the protection window are never auto-removed; only manual cleanup applies
- Pruning only deletes when a limit is actually exceeded — otherwise it just measures
- Pruning runs **before** a write, so a new snapshot always fits
- Every failure is swallowed: maintenance must never break an edit

### When the quota is exhausted

The toolkit enters a degraded state:

| Operation | Degraded behavior |
| --- | --- |
| `safe_edit` / `safe_write` / `multi_edit` | Refused, with the reason and a concrete recovery path |
| `safe_rollback` | Still allowed; the undo point becomes best-effort and the result says so |
| `safe_backups` / `syntax_check` / read-only work | Always allowed |

The refusal means "your work cannot be made reversible right now", not "the tool is broken". Recovery: `unpin` a few snapshots, delete old ones manually, or raise `DSH_SAFETY_BACKUP_MAX_BYTES`.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DSH_SAFETY_BACKUP_DIR` | `~/.dsh/safety-backups` | Relative paths resolve against the user home, never the process cwd |
| `DSH_SAFETY_BACKUP_MAX_BYTES` | `1073741824` (1GB) | Global size cap; `0` disables |
| `DSH_SAFETY_BACKUP_MAX_AGE_DAYS` | `14` | Remove beyond this age; `0` disables |
| `DSH_SAFETY_BACKUP_MIN_AGE_HOURS` | `24` | Protection window; never auto-removed |
| `DSH_SAFETY_BACKUP_KEEP_PER_FILE` | `10` | Snapshots kept per source file |
| `DSH_SAFETY_BACKUP_THROTTLE_MINUTES` | `5` | Prune interval while healthy; degraded state bypasses it |
| `DSH_SAFETY_BACKUP_MIN_FREE_MB` | `100` | Minimum free space on the backup partition |
| `DSH_SAFETY_PYTHON` | — | Pin a Python interpreter path for the syntax gate |

## Governance plugin

When enabled it does three things:

1. **Detects the shell this deployment actually has** and writes prompt guidance accordingly: `bash` gets `cat >` / `tee` / `sed -i`; `pwsh` gets `Set-Content` / `Out-File` / redirection.
2. **Scope shadowing**: on `agent/created` it installs `tools.restrict({ deny: ['write','edit'] })` for every agent, so those names disappear from the tool list and the prompt. It skips names that are not registered, avoiding `unknown tool` errors.
3. **Global monotonic guard** as the floor: `ctx.tools.guard()` denies runtime calls to `write` / `edit`. Scoped restrictions are not inherited by subagents; only a global guard covers them too.

Note: step 2 removes the built-in tool names entirely, which breaks any name-matched guard — see the [warning above](#warning-this-bypasses-name-matched-guards).

`bash` / `pwsh` are **not hard-blocked** — only prompt-constrained. Shell redirection writes files in ways a tool-layer guard cannot inspect reliably, and pretending otherwise would be security theater.

## Interface language

The title and description shown in the plugin manager come from `locale/` and follow the interface language:

| Entry | 中文 | English |
| --- | --- | --- |
| Toolkit | 安全工具包 | Safety Toolkit |
| Governance plugin | 写工具治理 | Write Governance |

Changing wording only requires editing `locale/*.json`; no rebuild is needed, since these are pure data files.

To add a third language, copy `locale/xx.json` and fill in the same `meta.title` / `meta.description`. `en.json` must stay — it is the discovery entry point.

Note: this affects **plugin presentation only**. Tool names, tool descriptions and model-facing error text are read by the model and do not vary with the interface language.

The plugin card icon comes from `"icon": "./icon.svg"` at the top level of `package.json`; the governance sub-plugin shares the same file via `"./governance/icon": "./icon.svg"`. Images must be self-contained and under 256 KiB; SVG / PNG / JPEG / WebP are supported.

## Installation

### From GitHub

```sh
dsh plugin --profile my-profile add github:your-account/dsh-safety-toolkit
```

`lib/` is committed, so no build script runs at install time and pnpm's `allowBuilds` authorization is not needed. Run `npm run build` before committing after source changes.

The only requirement: private repositories need working git credentials (HTTPS token or SSH key) on the machine.

### Local checkout

```sh
dsh plugin --profile demo add /absolute/path/to/dsh-safety-toolkit
```

### Patch overlay (instant reload while developing)

```sh
# Point the absolute paths in cordis.yml at your checkout first
pnpm dsh web --patch ./cordis.yml
```

The overlay loads `src/*.ts` directly and needs no build.

### Verify

```sh
dsh --profile my-profile --dump-config   # expect both safety-toolkit and safety-governance layers
```

To use the tools without enforced policy, remove the `safety-governance` entry from `cordis.patch.yml`.

## About the build

`build` runs `tsc --noCheck`: transpile only, no type checking. Installing environments have no `@deepseek-ai/*` type declarations, and a type-checking build exits non-zero.

**No `prepare` script on purpose.** Any install lifecycle script makes pnpm demand `allowBuilds` authorization (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`), and the authorization key embeds a commit hash that changes on every push. Committing the build output removes that entire path.

For local development:

```sh
npm install --legacy-peer-deps
npm run build
```

For real type checking, run `npm run typecheck` inside a dsh source checkout.

## Known limitations

- **The shell is an escape hatch.** Prompt guidance names the real shell and its bypass syntax, but nothing is hard-blocked; a tool layer cannot reliably parse arbitrary command text.
- **Subagents do not inherit scoped restrictions.** That is why governance uses both: `restrict` hides `write`/`edit` from the main agent, and a global `guard()` denies runtime calls everywhere, subagents included.
- **TypeScript / Rust get no syntax check.** They need project-level type information (`tsc --noEmit` / `cargo check`), which this gate does not run — regardless of whether an `lsp` tool is present.
- **The Python interpreter must actually execute.** The gate probes `python3` / `python` / `py -3` by running real code. Windows App Execution Alias stubs (exit code 9009) are correctly classified as "checker unavailable", not as syntax errors.
- **Only an explicit syntax diagnostic counts as an error.** If the checker itself misbehaves, the gate returns `skipped` rather than blocking a valid write.
- **Sensitive files get no special treatment.** `.env` and key files are snapshotted like any other file. If you do not want them on disk, change `DSH_SAFETY_BACKUP_DIR` or avoid editing them through these tools.

## Security notes

1. Snapshots contain **raw file contents** and may include secrets, tokens, or `.env` values. Permissions are `0700/0600`, but do **not** put the backup root in a repository or in a cloud sync folder (OneDrive, Dropbox).
2. The default root lives under `~/.dsh/`, outside any workspace, so `git clean -fdx` cannot reach it. If you point `DSH_SAFETY_BACKUP_DIR` inside a workspace, one `git clean -fdx` will delete every snapshot.
3. Protected (`.keep`) snapshots are never auto-removed; that is the only legitimate way to exhaust the quota. Once exhausted, writes are refused until you act.

## Emergency recovery

This plugin changes how dsh writes files, so it must be bypassable when it breaks itself. Three paths, none of which depend on the plugin:

1. **Disable governance only**: remove the `safety-governance` entry from `$DSH_HOME/profiles/<name>/cordis.patch.yml`, then restart. The tools stay; the enforcement stops.
2. **Take the plugin offline**: `dsh plugin --profile <name> remove dsh-safety-toolkit`, then restart.
3. **Worst case**: edit that `cordis.patch.yml` by hand, or delete this package from the profile's dependency directory.

On Windows, `$DSH_HOME` defaults to `C:\Users\<you>\.dsh`.

## Self-reference risks

The plugin runs inside dsh and also changes dsh's behavior, so three things are worth knowing:

- **Source edits do not take effect immediately.** Modules are already loaded; changes apply on restart. "The model raised its own quota default" is therefore not instant escalation — it is a **persistent backdoor that activates after a restart**.
- **Workspace isolation is the first line of defense.** Every file tool (including `safe_edit`) is confined to the session workspace. With the plugin source outside that workspace, the model cannot reach it. **Do not make the plugin directory an agent workspace while developing.**
- **Basename-based blocks only raise the cost.** A guard that refuses writes to `retention.ts` can be routed around by renaming the file. Real boundaries come from OS permissions and directory isolation, not from tool-layer rules.

## Updating

Git dependencies pin a specific commit, so updates are not automatic:

```sh
# Most reliable: remove and re-add to pull the latest commit
dsh plugin --profile <name> remove dsh-safety-toolkit
dsh plugin --profile <name> add github:SilverCrossing/dsh-safety-toolkit

# Or try update first (it may not re-resolve the git commit)
dsh plugin --profile <name> update dsh-safety-toolkit
```

You **must restart dsh** afterwards: the composition is evaluated at startup, and hot reload does not cover bundle membership changes. Confirm the version in the profile's `package.json`.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You may use, modify, and distribute this software freely. If you distribute a modified version, or offer it to others as a network service, you must publish the complete source under AGPL-3.0 as well.

Third-party dependencies are covered by their own license declarations.
