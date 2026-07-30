---
description: "Activate the clean-code commit gate for this repository — writes config and optionally installs the git pre-commit hook"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "AskUserQuestion"]
---

Activate clean-code for the current repository. Three phases: report, confirm,
apply. **Write nothing before the user confirms.**

## Phase 1 — Preflight report

Gather, then print. Do not interleave narration with the report.

1. `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" status` — repo root, current
   state (`dormant`/`paused`/`active`), which config files exist, and whether
   any managed hook block is already installed.
2. Detect the hook manager, in this order:
   - `.husky/` directory exists → **husky**
   - `.pre-commit-config.yaml` exists → **pre-commit framework**
   - otherwise → **bare .git/hooks**
3. Check for a pre-existing pre-commit hook that is not ours (`managed: false`
   with `present: true` in the status output).
4. Check the CLI: `command -v claude`.

Print exactly this shape, filling in real values:

```
Clean-code setup — preflight
  Repo:          <root>  (branch <branch>)
  Hook manager:  husky | pre-commit framework | bare .git/hooks
  Existing pre-commit hook:  none | present (will be chained, not replaced)
  claude CLI:    found | NOT FOUND (terminal commits will fail open with a warning)
  Current state: not installed | active | paused | partially installed (<details>)
```

If the repo is already active, do not offer a fresh install. Offer instead:
`Repair/upgrade in place` (rewrite the managed block, refresh the baked plugin
path — the fix after a plugin update or move) / `Nothing — just checking` /
`Cancel`. Phase 1 alone answers "is this repo gated, and by which paths?".

If `.claude/clean-code.policy.md` exists, add a line naming it and its
CODEOWNERS owner if one can be determined, and note that policy-mandated
settings will apply. In that case collapse Phase 2 to `Install` / `Cancel` —
do not offer choices the policy has already made.

## Phase 2 — Confirm

One AskUserQuestion, exactly these options:

| Label | Effect |
|---|---|
| `Full install (Recommended)` | Session gate + git-native hook + config |
| `Session gate only` | Config file only; Claude's commits gated, terminal commits are not |
| `Cancel` | No changes |

## Phase 3 — Apply

### 3a — Config file (always)

Write `.claude/clean-code.local.md` with exactly these defaults:

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

Text below the frontmatter is appended verbatim to the reviewer's prompt.
Put project-specific conventions here, for example: "domain layer must not
import adapters", "prefer Result returns over thrown errors in src/core".
```

This file is the opt-in sentinel — its presence with `enabled: true` is what
activates the gate. Never write it outside the repo root's `.claude/`.

If it already exists, do not overwrite it: report that it was kept as-is.

### 3b — Git hook (Full install only)

Resolve the absolute plugin path now — `${CLAUDE_PLUGIN_ROOT}` does not exist in
git's environment, so it must be baked into the hook text.

**husky** — append to `.husky/pre-commit` (create it if absent):

```sh
# >>> clean-code gate >>> (managed by clean-code; remove via /clean-code:remove)
sh "<ABSOLUTE_PLUGIN_ROOT>/scripts/pre-commit.sh"
# <<< clean-code gate <<<
```

**pre-commit framework** — append to `.pre-commit-config.yaml`:

```yaml
# >>> clean-code gate >>>
  - repo: local
    hooks:
      - id: clean-code-gate
        name: clean-code review gate
        entry: <ABSOLUTE_PLUGIN_ROOT>/scripts/pre-commit.sh
        language: system
        pass_filenames: false
        stages: [pre-commit]
# <<< clean-code gate <<<
```

Match the file's existing indentation for the list item. If there is no `repos:`
key yet, add one.

**bare .git/hooks** — write the shim to `<hooks_dir>/pre-commit`, taking
`hooks_dir` from the `status` output. Never derive this path from
`git rev-parse --git-dir`: in a linked worktree that resolves to
`.git/worktrees/<name>/hooks/`, where git will never execute a hook, and the
install would silently gate nothing.

```sh
#!/usr/bin/env sh
# >>> clean-code gate >>> (managed by clean-code; remove via /clean-code:remove)
CHAINED="$(dirname "$0")/pre-commit.chained"
[ -x "$CHAINED" ] && { "$CHAINED" "$@" || exit $?; }
exec sh "<ABSOLUTE_PLUGIN_ROOT>/scripts/pre-commit.sh"
# <<< clean-code gate <<<
```

`chmod +x` it. If a pre-existing hook is there and is not ours, rename it to
`pre-commit.chained` **first** so the shim runs it before the review — cheap
existing checks should fail before the slow one. Report the rename.

If `status` reports `linked_worktree: true`, add this line to the summary:

> Note: git shares hooks across all worktrees of this repository, so the hook
> is now installed for every one of them. Activation stays per-worktree — each
> needs its own `.claude/clean-code.local.md` to be gated.

### 3c — Always finish with

- If `.claude/clean-code.local.md` is not already ignored, print (do **not**
  apply) a suggested `.gitignore` line — the file is per-user by design.
- Print the CI snippet for the repo's CI system, noting that re-running the gate
  server-side is the only real defense against `--no-verify`. Do not commit it.
- Print the apply summary — only lines for things that actually happened:

```
Installed.
  ✓ <hook file> — gate block appended
  ✓ .claude/clean-code.local.md written — gate is now ACTIVE for this repo
  ✓ existing hook preserved: <path>.chained (runs before gate)
  ℹ suggested .gitignore line: .claude/clean-code.local.md
  ℹ CI snippet printed above
The gate is silent until a commit needs review. Nothing else to do.
```

Do not commit any of these changes. Whether the hook-manager files get committed
is the user's decision, and for a team repo it is a decision with consequences.
