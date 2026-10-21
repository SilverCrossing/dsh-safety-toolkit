# DeepSeek Harness Safety Toolkit

English | [中文](README.md)

Adds the three things DeepSeek Harness (dsh) lacks for file work: **reversible destructive edits, a write gate, and structured results**. Seven tools plus an independently toggleable governance plugin.

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

`bash` / `pwsh` are **not hard-blocked** — only prompt-constrained. Shell redirection writes files in ways a tool-layer guard cannot inspect reliably, and pretending otherwise would be security theater.

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

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You may use, modify, and distribute this software freely. If you distribute a modified version, or offer it to others as a network service, you must publish the complete source under AGPL-3.0 as well.

Third-party dependencies are covered by their own license declarations.
