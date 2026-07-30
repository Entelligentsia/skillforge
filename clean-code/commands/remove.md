---
description: "Remove or pause the clean-code commit gate for this repository, restoring any hook it replaced"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "AskUserQuestion"]
---

Tear down clean-code in the current repository. Three phases: report, confirm,
apply. **Delete nothing before the user confirms.**

## Phase 1 — State report

Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" status` and read the config file
if present. Print:

```
Clean-code removal — current state
  Hook:    <manager> block present (<file>) | none
           (chained hook: <path>.chained will be restored)
  Config:  .claude/clean-code.local.md (<K> lines of custom guidance below frontmatter)
  Policy:  .claude/clean-code.policy.md — TRACKED, team-owned (will not be deleted)
  State:   <git-dir>/clean-review/ — <N> markers, bypass.log <E> entries
  ⚠ pending.json holds <M> untriaged findings from <date>
```

Include the policy line only if that file exists, the pending line only if
findings are pending, and the chained line only if a backup exists.

## Phase 2 — Confirm

One AskUserQuestion:

| Label | Effect |
|---|---|
| `Remove everything (Recommended)` | Hook block + state dir + personal config |
| `Pause instead` | Set `enabled: false`; delete nothing |
| `Remove hook, keep config` | Terminal commits ungated; session gate stays active |
| `Cancel` | No changes |

If the config body has custom guidance below the frontmatter and the user chose
to delete it, ask one follow-up: print that guidance into the transcript first so
it is not silently lost? (yes/no). Honour the answer before deleting.

## Phase 3 — Apply

### Hook removal

- **husky** — delete the `# >>> clean-code gate >>>` … `# <<< clean-code gate <<<`
  block only. If the file is then empty apart from a shebang or whitespace,
  delete the file. Never touch other hook lines.
- **pre-commit framework** — delete the marked block from
  `.pre-commit-config.yaml`; leave the rest of the file byte-identical.
- **bare .git/hooks** — delete the shim at `<hooks_dir>/pre-commit`, taking
  `hooks_dir` from the `status` output rather than deriving it from
  `git rev-parse --git-dir` (wrong in a linked worktree, where it would leave
  the live hook running). If `pre-commit.chained` exists there, rename it back
  to `pre-commit` and preserve its executable bit.
  When `status` reports `linked_worktree: true`, say plainly that the hook is
  shared and removing it ungates **every** worktree of this repository.

### State and config

- Delete `<git-dir>/clean-review/` recursively — markers, `pending.json`, and
  `bypass.log`. The Phase 1 report was the last look at them, which is why it
  reports their counts.
- Delete `.claude/clean-code.local.md` (unless `Remove hook, keep config`).
- **Never delete `.claude/clean-code.policy.md`.** It is tracked and belongs to
  the team's git history; removing it is a pull request, not a local teardown.
  If it exists, say so: the repo stays opted in for anyone who has the plugin,
  and deactivating it repo-wide means changing that file through review.

### Summary

Print only what happened:

```
Removed.
  ✓ <hook file> — gate block deleted (file kept, other hooks intact)
  ✓ <git-dir>/clean-review/ deleted (<N> markers, bypass.log)
  ✓ .claude/clean-code.local.md deleted
  ✓ restored: <git-dir>/hooks/pre-commit (was pre-commit.chained)
Not touched: the plugin itself (other repos unaffected). To remove it from the
machine: /plugin uninstall clean-code@skillforge
```

Then verify and state the guarantee plainly: after `Remove everything`, nothing
in the repo references clean-code and commits behave exactly as they did before
setup ever ran. If a policy file remains, say that instead of claiming a clean
removal — an accurate report matters more than a tidy one.
