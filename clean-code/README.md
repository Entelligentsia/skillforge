# clean-code

A commit-time clean-code review gate for Claude Code.

Skills advise; they cannot guarantee. This plugin puts a deterministic gate at
the one place where guarantees are cheap and meaningful — the commit — and keeps
the daily experience quiet: **one interception point, one review, one decision,
and silence whenever there is nothing to decide.**

## What it does

When a commit is attempted and the staged changes have not been reviewed, the
gate blocks it, a reviewer agent reads the staged diff against a clean-code
rubric, and you get exactly one question:

```
src/auth.ts:142 — [base] validateAndSaveUser does validation, persistence, and email dispatch
    A reviewer would block: the three concerns cannot be tested or changed independently.
    Fix: extract validateUser and sendWelcomeEmail; leave saveUser as the persistence step.

  [Apply all fixes]  [Apply selected]  [I'll fix manually]  [Commit anyway]
```

Apply fixes and the commit continues — no re-review, no loop. Choose to fix
manually and the findings survive as a `file:line` checklist. When the review
finds nothing, you see one line and the commit proceeds.

The gate is silent on success by design. A gate that announces itself when
there is nothing to report trains you to resent it.

## What it is not

It is not a linter. Formatting, import order, and line length belong to your
project's formatter, and the reviewer is explicitly told to ignore anything the
linter already permits. This catches what tools cannot decide: responsibilities
that should be split, names that have become untrue, swallowed errors, tests
coupled to implementation.

## Install

```
/plugin marketplace add Entelligentsia/skillforge
/plugin install clean-code@skillforge
```

Installing changes nothing yet — the gate is dormant in every repository until a
repo opts in. Then, inside a repo you want gated:

```
/clean-code:setup
```

Setup reports what it found (hook manager, existing hooks, CLI availability),
asks once, and only then writes. Full install adds a git `pre-commit` hook so
commits from your own terminal are gated too; session-only install gates just
Claude's commits. Re-run `/clean-code:setup` any time as a status check.

## Configure

Everything lives in `.claude/clean-code.local.md` (untracked, per-user). Its
presence with `enabled: true` is what activates the gate.

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | `false` pauses the gate without deleting anything |
| `severity_threshold` | `major` | Minimum severity that blocks; below it, findings are advisory |
| `exclude` | lockfiles, `dist/**`, `**/generated/**`, `vendor/**` | Paths removed from the diff before review |
| `max_diff_lines` | `1500` | Above this you are warned and offered a chunked review — never a silent skip |
| `fail_mode` | `open` | Terminal-commit behavior when the CLI is missing or times out |
| `headless_timeout_s` | `180` | Review time limit for terminal commits |
| `log_bypass` | `true` | Records every bypass in `.git/clean-review/bypass.log` |

Markdown below the frontmatter is appended verbatim to the reviewer's prompt —
the place for project rules like *"domain layer must not import adapters"*.
Changes take effect immediately; there is no cache or restart.

To bypass a single commit: `SKIP_CLEAN_REVIEW=1 git commit …` (logged).

## Remove

```
/clean-code:remove
```

Reports exactly what exists, asks, then removes only what it installed — the
marked hook block (restoring any hook it chained), the state directory, and the
config file. Afterwards nothing in the repo references clean-code and commits
behave exactly as they did before. To remove it from the machine, run
`/plugin uninstall clean-code@skillforge` **after** removing it from each repo.

## Commands

| Command | Purpose |
|---|---|
| `/clean-code:review` | Review staged changes and resolve the gate (usually triggered for you) |
| `/clean-code:resume` | Re-open saved findings without paying for a second review |
| `/clean-code:setup` | Activate for this repo; also the status check |
| `/clean-code:remove` | Tear down, or pause |

## Skills

Four skills carry generation-time judgment — the decisions a linter cannot make:
`naming-and-structure`, `error-handling`, `refactoring-triggers`, and
`testing-discipline`. They cite the same rubric in `docs/principles/` that the
reviewer uses, so what you are told while writing and what you are held to at
commit time cannot drift apart.

## Honest limits

- **A local hook is not a guarantee.** `--no-verify`, a bypass env var, or
  editing the hook all work — that is true of every pre-commit tool. The gate
  makes bypass *visible* (logged locally, recorded as a commit trailer) rather
  than pretending to prevent it. For a real guarantee, run the same review in CI:
  see `ci/github-actions.yml`.
- **Reviews cost time.** Roughly 30–90 seconds on an unreviewed diff. Results
  are cached against the exact staged tree, so retries and amend loops are free.
  This plugin suits deliberate commits more than commit-every-ten-minutes flow.
- **The reviewer can be wrong.** It is calibrated to report only what a senior
  reviewer would block a PR over, and "Commit anyway" exists precisely because
  the calibration will sometimes miss.

## For teams

Layered rulesets, a tracked policy file with lockable settings, versioned
rulepacks, commit-trailer audit, and the CI ratchet are specified in
[`docs/ENTERPRISE.md`](docs/ENTERPRISE.md). The developer-facing flow is
identical; what changes is who decides the rules.

## Documentation

| Document | Contents |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Component design, state model, edge-case matrix |
| [`docs/LIFECYCLE.md`](docs/LIFECYCLE.md) | Exact install / configure / remove specification |
| [`docs/ENTERPRISE.md`](docs/ENTERPRISE.md) | Rulesets, governance, CI enforcement |
| [`docs/principles/`](docs/principles/) | The rubric itself |

## Tests

```
bash tests/gate.test.sh
```

80 assertions covering the deterministic core with no model in the loop: commit
detection, review identity, marker lifecycle, opt-in and pause, bypass logging,
config resolution and policy locks, severity thresholds, and the git-hook path
end to end against a stub CLI.

## Licence

MIT © Entelligentsia
