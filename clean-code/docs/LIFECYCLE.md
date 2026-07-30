# clean-code — Install / Configure / Remove UX (exact specification)

This document is the normative UX for the subsystem's lifecycle in a repo.
Every path the subsystem ever touches, every prompt shown, and every teardown
step is specified here. Companion to DESIGN.md.

## 0. Lifecycle states

```
NOT INSTALLED ──/plugin install──▶ DORMANT ──/clean-code:setup──▶ ACTIVE
                                     ▲                            │  ▲
                                     │                 enabled:false  enabled:true
                                     │                            ▼  │
              /clean-code:remove ◀───┴────────────────────────  PAUSED
```

- **DORMANT** — plugin installed on the machine; commands/skills available, but
  the commit gate does nothing in any repo (gate.js step 0 finds no opt-in file).
  Installing the plugin never changes commit behavior anywhere by itself.
- **ACTIVE** — repo has `.claude/clean-code.local.md` with `enabled: true`.
  Both gate paths (session hook + git hook if installed) enforce.
- **PAUSED** — config exists with `enabled: false`. All files stay; both gate
  paths pass silently.

## 1. Install

### 1.1 Machine level (once)

```
/plugin marketplace add Entelligentsia/skillforge   # if not already added
/plugin install clean-code@skillforge
```

Delivers: commands (`/clean-code:review|resume|setup|remove`), 4 skills, the
reviewer agent, and the PreToolUse session hook — **dormant** everywhere until
a repo opts in. No repo files are touched.

### 1.2 Repo level — `/clean-code:setup`

Run inside the target repo. The command is a strict three-phase flow:
report → confirm → apply. It never writes before the confirmation gate.

**Phase 1 — preflight report** (printed verbatim, values resolved live):

```
Clean-code setup — preflight
  Repo:          /path/to/repo  (branch main)
  Hook manager:  husky | pre-commit framework | bare .git/hooks | none detected
  Existing pre-commit hook:  none | present (will be chained, not replaced)
  claude CLI:    found vX.Y | NOT FOUND (terminal commits will fail open with a warning)
  Current state: not installed | active | paused | partially installed (details)
```

**Phase 2 — confirmation** (AskUserQuestion, fixed options):

| Option | Effect |
|---|---|
| **Full install (Recommended)** | Session gate + git-native hook + config |
| **Session gate only** | Config file only; commits from Claude are gated, terminal commits are not |
| **Cancel** | No changes |

**Phase 3 — apply.** Exact changes by hook manager:

- **husky** — append to `.husky/pre-commit` (create the file if absent):
  ```sh
  # >>> clean-code gate >>> (managed by clean-code plugin; remove via /clean-code:remove)
  sh "/abs/path/to/plugins/clean-code/scripts/pre-commit.sh"
  # <<< clean-code gate <<<
  ```
- **pre-commit framework** — append to `.pre-commit-config.yaml`:
  ```yaml
  # >>> clean-code gate >>>
  - repo: local
    hooks:
      - id: clean-code-gate
        name: clean-code review gate
        entry: /abs/path/to/plugins/clean-code/scripts/pre-commit.sh
        language: system
        pass_filenames: false
        stages: [pre-commit]
  # <<< clean-code gate <<<
  ```
- **bare `.git/hooks`** — write `.git/hooks/pre-commit` shim. If a pre-existing
  hook is found (and is not ours), it is renamed to `pre-commit.chained` and the
  shim executes it **first** (cheap existing checks before the slow review),
  then runs the gate. The rename is reported in the apply summary.

Always (all managers):

- Write `.claude/clean-code.local.md` with the default config (see §2). This
  file is the opt-in sentinel — its presence with `enabled: true` is what
  activates both gate paths.
- If `.claude/clean-code.local.md` is not matched by `.gitignore`, print (do not
  apply) a suggested ignore line — the file is per-user by design.
- Print the CI snippet (re-run the same gate server-side); committing it is the
  user's choice and the only defense against `--no-verify`.
- The plugin's absolute root path is resolved **now** and baked into the hook
  lines (git runs hooks without `${CLAUDE_PLUGIN_ROOT}`).

**Apply summary** (printed verbatim, only lines that happened):

```
Installed.
  ✓ .husky/pre-commit — gate block appended (lines N–M)
  ✓ .claude/clean-code.local.md written — gate is now ACTIVE for this repo
  ✓ existing hook preserved: .git/hooks/pre-commit.chained (runs before gate)
  ℹ suggested .gitignore line: .claude/clean-code.local.md
  ℹ CI snippet printed above
The gate is silent until a commit needs review. Nothing else to do.
```

**Idempotence:** re-running `/clean-code:setup` on an installed repo prints the
preflight state report and offers: `Repair/upgrade in place` (rewrites the
managed block and refreshes the baked path — the fix after a plugin update or
move) / `Nothing — just checking` / `Cancel`. Re-run setup any time as the
status check; phase 1 alone answers "is this repo gated, and by which paths?"

## 2. Configure

All configuration lives in one file: **`.claude/clean-code.local.md`**.
Written by setup with these exact defaults:

```markdown
---
enabled: true
severity_threshold: major
exclude:
  - "**/*.lock"
  - "dist/**"
  - "**/generated/**"
  - "vendor/**"
max_diff_lines: 1500
fail_mode: open
headless_timeout_s: 180
log_bypass: true
---
# Project review guidance (optional)

Free text below the frontmatter is appended verbatim to the reviewer's prompt.
Put project-specific conventions here, e.g. "domain layer must not import
adapters", "we prefer Result returns over thrown errors in src/core".
```

Key reference:

| Key | Type / values | Default | Effect | Read by |
|---|---|---|---|---|
| `enabled` | bool | `true` | `false` = PAUSED: both gate paths pass silently; nothing else changes | gate.js step 0, git shim |
| `severity_threshold` | `blocker` \| `major` | `major` | Minimum severity that gates; below it → advisory (shown, never blocks) | review command |
| `exclude` | glob list | lockfiles, dist, generated, vendor | Paths stripped from the diff before the reviewer sees it | review command, headless |
| `max_diff_lines` | int | `1500` | Above this: warn + offer chunked review or explicit bypass; never silent skip | review command |
| `fail_mode` | `open` \| `closed` | `open` | Git-hook behavior when claude CLI is missing/times out/errors: `open` = warn + allow, `closed` = block | git shim |
| `headless_timeout_s` | int | `180` | Max wall time for the headless review on terminal commits | git shim |
| `log_bypass` | bool | `true` | Append every bypass (env var or "Commit anyway") to `.git/clean-review/bypass.log` | gate.js |
| body text | markdown | empty | Appended to reviewer prompt — project-specific rubric | reviewer agent |

**When changes take effect:** immediately. Every gate check and every review
spawn reads the file fresh; there is no daemon, cache, or session restart.

**Ad-hoc controls (no file edit):**

- `SKIP_CLEAN_REVIEW=1 git commit …` — bypass one commit, either path. Logged
  when `log_bypass: true`.
- "Commit anyway" at the review gate — bypass this diff only, logged with
  verdict `user-approved`.
- Pause vs remove: `enabled: false` is the reversible off-switch; keep it for
  "off for this sprint". Removal (§3) is for "off permanently".

## 3. Remove

### 3.1 Repo level — `/clean-code:remove`

Mirror of setup: report → confirm → apply. Never deletes before confirmation.

**Phase 1 — state report** (verbatim; only applicable lines):

```
Clean-code removal — current state
  Hook:    husky block present (.husky/pre-commit lines N–M)
           | pre-commit-config entry present | .git/hooks shim present
           (chained hook: pre-commit.chained will be restored)
  Config:  .claude/clean-code.local.md (has K lines of custom guidance below frontmatter)
  State:   .git/clean-review/ — N markers, bypass.log E entries
  ⚠ pending.json holds M untriaged findings from <date>   # only if present
```

**Phase 2 — confirmation** (AskUserQuestion):

| Option | Effect |
|---|---|
| **Remove everything (Recommended)** | Hook block + state dir + config file |
| **Pause instead** | Sets `enabled: false`; deletes nothing |
| **Remove hook, keep config** | Terminal commits ungated; session gate stays (config still opts in) |
| **Cancel** | No changes |

If the config body contains custom guidance (anything below the frontmatter),
"Remove everything" asks one follow-up before deleting the file: print the
guidance text into the transcript so it isn't silently lost? (yes/no).

**Phase 3 — apply.** Exact teardown by manager:

- **husky** — delete the `>>> clean-code gate >>> … <<<` block only; if the file
  is then empty (only whitespace/shebang), delete the file.
- **pre-commit framework** — delete the marked block from
  `.pre-commit-config.yaml`; the rest of the file is untouched.
- **bare hooks** — delete our shim; if `pre-commit.chained` exists, rename it
  back to `pre-commit`.
- Delete `.git/clean-review/` recursively (markers, pending.json, bypass.log —
  all derivable or historical; the state report above is the last look at them).
- Delete `.claude/clean-code.local.md` (per the chosen option).

**Apply summary** (verbatim pattern):

```
Removed.
  ✓ .husky/pre-commit — gate block deleted (file kept, other hooks intact)
  ✓ .git/clean-review/ deleted (14 markers, bypass.log)
  ✓ .claude/clean-code.local.md deleted
  ✓ restored: .git/hooks/pre-commit (was pre-commit.chained)
Not touched: the plugin itself (other repos unaffected). To remove it from the
machine: /plugin uninstall clean-code@skillforge
```

**Guarantee:** after "Remove everything", `git grep -I clean-code` plus a look at
`.git/hooks` and `.claude/` shows zero trace; commits behave exactly as before
setup was ever run.

### 3.2 Machine level

```
/plugin uninstall clean-code@skillforge
```

**Ordering rule: run `/clean-code:remove` in every set-up repo first.** If the
plugin is uninstalled while a repo's git hook still points at the baked path,
the shim's first line self-checks that the path exists; on failure it prints
one line — `clean-code: plugin files missing — gate skipped (run
/clean-code:remove in this repo to clean up)` — and exits 0 regardless of
`fail_mode`. A dangling hook degrades to a one-line notice, never a bricked commit.

## 4. Complete state inventory

Every path the subsystem ever creates or edits, and which action undoes it:

| Path (in target repo unless noted) | Created/edited by | Contents | Undone by |
|---|---|---|---|
| `.claude/clean-code.local.md` | setup | opt-in sentinel + config + custom rubric | remove |
| `.husky/pre-commit` marked block | setup (husky repos) | one `sh …pre-commit.sh` line | remove |
| `.pre-commit-config.yaml` marked block | setup (framework repos) | local hook entry | remove |
| `<git rev-parse --git-path hooks>/pre-commit` shim (+ `.chained` rename) | setup (bare repos) | shim; original preserved | remove (restores original) |
| `$(git rev-parse --git-dir)/clean-review/` | gate.js, lazily | `reviewed/<id>` markers, `pending.json`, `bypass.log` | remove |
| Plugin dir (machine, under plugin root) | `/plugin install` | code, skills, agent, hook config | `/plugin uninstall` |

**Worktrees:** git shares one hooks directory across all worktrees of a
repository, so installing the hook from any worktree installs it for all of
them. Activation stays per-worktree — a worktree without
`.claude/clean-code.local.md` is dormant even with the hook live — and review
state (`clean-review/`) is per-worktree by design, so an approval in one never
satisfies the gate in another.

Nothing else is written anywhere — no home-directory state, no env mutations,
no tracked-file changes unless the user commits the CI snippet or hook-manager
files themselves.
