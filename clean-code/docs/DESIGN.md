# clean-code plugin — Detailed Design

Status: design accepted at UX level; this document specifies building blocks.
UX contract (accepted): one deterministic interception point at commit time, one
model-driven review of the staged diff, one AskUserQuestion decision
(apply all / apply selected / fix manually / commit anyway), and silence whenever
there is nothing to decide.

## 1. Component inventory

| # | Block | Kind | Role in the UX |
|---|-------|------|----------------|
| B1 | State store | files under `$(git rev-parse --git-dir)/clean-review/` | Makes the gate deterministic and idempotent |
| B2 | Gate script | Node script, no model | Decides open/pass in <50ms; shared by both commit paths |
| B3 | Claude Code hook | `hooks/hooks.json` (PreToolUse on Bash) | Intercepts Claude-driven `git commit` |
| B4 | Reviewer agent | `agents/clean-code-reviewer.md` | Produces structured findings from the staged diff |
| B5 | Review command | `commands/review.md` (`/clean-code:review`) | Orchestrates review → gate → apply/abort/commit |
| B6 | Resume command | `commands/resume.md` | Reopens the gate from `pending.json` (terminal path) |
| B7 | Git-native hook | `scripts/pre-commit.sh` template | Same gate for human commits; headless review via `claude -p` |
| B8 | Setup command | `commands/setup.md` (`/clean-code:setup`) | Explicit, user-approved installation of B7 + default config |
| B9 | Skills | `skills/*/SKILL.md` | Generation-time judgment guidance |
| B10 | Principles corpus | `docs/principles/*.md` | Single source of truth shared by B4 and B9 |
| B11 | Project config | `.claude/clean-code.local.md` in target repo | Repo opt-in sentinel + thresholds, excludes, fail mode |
| B12 | Remove command | `commands/remove.md` (`/clean-code:remove`) | Exact, per-manager teardown of everything setup created |

## 2. Directory layout

```
clean-code/
├── .claude-plugin/plugin.json
├── README.md
├── LICENSE
├── assets/banner.png
├── hooks/
│   ├── hooks.json                  # PreToolUse matcher → gate.js check
│   └── gate.js                     # B2: check | hash | mark | pending | prune
├── commands/
│   ├── review.md                   # /clean-code:review — the orchestrator
│   ├── resume.md                   # /clean-code:resume — triage pending findings
│   ├── setup.md                    # /clean-code:setup — install git hook + config
│   └── remove.md                   # /clean-code:remove — per-manager teardown
├── agents/
│   └── clean-code-reviewer.md      # B4: read-only reviewer, structured output
├── scripts/
│   └── pre-commit.sh               # B7 template; baked plugin path at install
├── skills/
│   ├── naming-and-structure/SKILL.md
│   ├── error-handling/SKILL.md
│   ├── refactoring-triggers/SKILL.md
│   └── testing-discipline/SKILL.md
└── docs/
    ├── DESIGN.md                   # this file
    └── principles/                 # B10 — one file per principle area
        ├── naming.md
        ├── functions.md
        ├── errors.md
        └── tests.md
```

## 3. B1 — State store (the keystone)

Location: `$(git rev-parse --git-dir)/clean-review/` (never literal `.git/` —
worktrees and submodules make `.git` a file). Never tracked; no gitignore needed.

**Review identity is NOT a diff-text hash.** Diff text varies with diff.algorithm
and context settings. Identity is the plumbing-stable pair:

```
review_id = <HEAD commit sha OR "empty" for initial commit> + "-" + <git write-tree of index>
```

Two properties fall out for free: any change to staged content or to the base
commit invalidates prior review; rewording/amending with identical content does not.

Files:

```
clean-review/
├── reviewed/<review_id>          # JSON: {verdict, at, findings_count, source}
│                                 # verdict ∈ passed | fixes-applied | user-approved | bypassed
├── pending.json                  # findings awaiting triage + the review_id they bind to
└── bypass.log                    # append-only: timestamp, review_id, actor (env|option)
```

GC: `gate.js prune` keeps newest 50 markers or 30 days, called opportunistically
on each `check`.

## 4. B2 — Gate script (`hooks/gate.js`)

Plain Node, zero deps (matches security-watchdog precedent). Subcommands:

- `check` — reads PreToolUse stdin JSON. Pipeline:
  0. Repo opted in? `.claude/clean-code.local.md` exists with `enabled` not
     `false` → continue; otherwise allow (plugin install alone gates nothing).
  1. Is the Bash command a commit? Strip quoted strings, then match
     `git [global-opts] commit` (handles `git -C x commit`, `git commit -am`).
     Not a commit → allow (exit silent).
  2. `SKIP_CLEAN_REVIEW=1` present (env or inline) → allow + append `bypass.log`.
  3. In-progress merge / cherry-pick / rebase (`MERGE_HEAD`, `CHERRY_PICK_HEAD`,
     `rebase-merge/`) → allow (these replay reviewed or external content).
  4. Staged tree == HEAD tree (empty diff: reword, `--allow-empty`) → allow.
  5. Marker `reviewed/<review_id>` exists → allow.
  6. Else → deny with `permissionDecisionReason` that carries the deterministic
     instruction: *"Staged diff has not passed clean-code review. Run
     /clean-code:review now; do not retry the commit until it completes."*
- `hash` — prints current `review_id`.
- `mark <verdict>` — writes marker for the current `review_id`.
- `pending [read|write|clear]` — manages `pending.json`.
- `prune` — GC.

Design rule: gate.js contains **no policy about code quality** — only commit
detection and state. All quality judgment lives in B4/B10.

## 5. B3 — hooks.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/gate.js\" check",
            "timeout": 5 }
        ]
      }
    ]
  }
}
```

Fires on every Bash call; non-commit commands exit in ~10ms. Timeout is 5
**seconds** (hook timeouts are seconds, not milliseconds — a wrong unit here
silently removes the protection). Two independent fail-open paths are required:
the try/catch in `check` covers thrown errors, and the hook timeout covers
hangs, which the catch cannot. A broken gate must never brick the session.

## 6. B4 — Reviewer agent

`agents/clean-code-reviewer.md`. Read-only tool set (Read, Grep, Bash restricted
to `git show`/`git diff`). Critical mechanics:

- Reviews **staged content, not the worktree**: file bodies via `git show :<path>`
  (partial staging means the worktree may differ).
- Input: `git diff --staged` plus config from B11 (excluded globs already
  filtered out by the command before spawn).
- Calibration line (verbatim in the prompt): *"Report only findings a senior
  reviewer would block the PR over. Style already permitted by the project's
  linter is out of scope."* Principles corpus (B10) is the rubric.
- Output: strict JSON findings array (the command validates; malformed → one retry).

Findings schema:

```json
{
  "id": "f1",
  "file": "src/auth.ts",
  "line": 142,
  "principle": "functions/single-responsibility",
  "severity": "blocker | major",
  "confidence": "high | medium",
  "summary": "one sentence",
  "rationale": "why a reviewer would block",
  "fix": { "type": "edit | advice", "description": "what to change" }
}
```

Only `severity ∈ {blocker, major}` AND `confidence = high` gate the commit.
Everything else is emitted under `advisory` and shown as FYI, never gating —
this is the anti-fatigue valve.

## 7. B5 — /clean-code:review (orchestrator state machine)

```
S0 collect   git diff --staged; apply B11 excludes; if oversize (> max_diff_lines)
             → warn + offer chunked review or explicit bypass
S1 review    spawn B4 with the filtered diff
S2 branch    findings empty → gate.js mark passed → retry commit → END (one line)
S3 gate      findings present → MUST call AskUserQuestion (multiSelect for
             apply-selected variant), fixed options:
             [Apply all fixes] [Apply selected] [I'll fix manually] [Commit anyway]
S4a apply    edit worktree per fix; git add each touched file
             — partial-staging hazard: if worktree≠index for a touched file
               BEFORE editing, surface it in the apply summary (extra hunks get staged)
             show compact edit summary (no second question)
             gate.js mark fixes-applied   # post-fix review_id; no re-review loop
             retry commit → END
S4b manual   gate.js pending write; abort; echo findings as file:line checklist → END
S4c anyway   gate.js mark user-approved; retry commit → END
```

Determinism is enforced structurally: S3's "MUST call AskUserQuestion with
exactly these options" lives in the command markdown, and the hook (B3) keeps
blocking until a marker exists — Claude cannot skip the gate even if it ignores
the instruction, because the commit stays denied.

## 8. B6 — /clean-code:resume

Reads `pending.json`; if its bound `review_id` still matches the current index →
re-enter S3 with the saved findings (no re-review). If stale (user edited since)
→ say so and fall through to a fresh `/clean-code:review`.

## 9. B7 — git-native pre-commit (terminal path)

`scripts/pre-commit.sh`, installed by B8 with the plugin root path baked in at
install time (`${CLAUDE_PLUGIN_ROOT}` does not exist in git's environment):

1. Same steps 2–5 as gate.js `check` (delegates to `gate.js` via baked path).
2. Unreviewed → headless review: `claude -p` invoking B4's prompt against the
   staged diff, JSON output, timeout from B11 (default 180s).
3. Zero gating findings → `mark passed`, commit proceeds, one line printed.
4. Findings → `pending write`, print findings + exactly two exits:
   fix & re-commit, or `claude "/clean-code:resume"`.
5. Failure policy (claude CLI missing, timeout, malformed output):
   `fail_mode` from B11 — default **fail-open with a loud warning** (a review
   tool that can brick commits gets uninstalled), optional fail-closed for teams.

## 10. B8 — /clean-code:setup

Explicit and user-approved (never automatic — that is watchdog-flagged behavior):
detect husky / pre-commit framework / bare `.git/hooks`; install or chain the
shim without clobbering existing hooks; write default `.claude/clean-code.local.md`;
print a CI snippet (re-run the same check server-side — the honest guarantee).
Idempotent: re-running upgrades the shim in place.

## 11. B9/B10 — Skills and principles corpus

Skills carry only judgment linters can't check; each SKILL.md is a thin
trigger + digest that points into `docs/principles/*.md`. The reviewer agent
(B4) cites the same files. One rubric, two consumers — generation and review
can never drift apart.

| Skill | Trigger scope | Principle files |
|---|---|---|
| naming-and-structure | writing/renaming code | naming.md, functions.md |
| error-handling | try/catch, Result types, validation | errors.md |
| refactoring-triggers | "clean up", "refactor", growing functions | functions.md |
| testing-discipline | writing tests | tests.md |

## 12. B11 — Project config (`.claude/clean-code.local.md`)

YAML frontmatter (plugin-settings pattern):

```yaml
enabled: true                    # repo opt-in; false pauses both gate paths
severity_threshold: major        # minimum gating severity
exclude: ["**/*.lock", "dist/**", "**/generated/**", "vendor/**"]
max_diff_lines: 1500
fail_mode: open                  # git-native hook: open | closed
headless_timeout_s: 180
```

Body: free-text project-specific review guidance, appended to B4's prompt.

## 13. Edge-case matrix

| Case | Behavior | Where |
|---|---|---|
| Merge / cherry-pick / rebase in progress | Gate skipped | B2 step 3 |
| Amend, content unchanged (reword) | Tree==HEAD tree → pass | B2 step 4 |
| Amend with new content | New review_id → gate opens | B1 identity |
| Initial commit (no HEAD) | `empty` sentinel in review_id | B1 |
| Partial staging | Review staged blobs (`git show :path`); apply-fix warns on dirty files | B4, S4a |
| Binary files | Excluded from diff sent to reviewer | S0 |
| Oversize diff | Warn; chunk or explicit bypass — never silent skip | S0 |
| Two sessions racing | Markers idempotent; last write wins harmlessly | B1 |
| Submodules, non-standard git dirs | `git rev-parse --absolute-git-dir`, never literal `.git` | B1 |
| Linked worktree — review state | Per-worktree (`--absolute-git-dir`): each worktree stages different content, so sharing markers would let one worktree's approval satisfy another's gate | B1 |
| Linked worktree — hook path | Common dir (`--git-path hooks`): worktrees have no `hooks/`, git redirects lookup. Deriving the hook path from `--git-dir` installs where git never runs it, silently gating nothing | B2, B7, B8, B12 |
| `commit` appearing inside `-m "..."` | Quoted strings stripped before matching | B2 step 1 |
| Bypass | `SKIP_CLEAN_REVIEW=1` or "Commit anyway" — both logged | B2, S4c |
| Broken gate/CLI | Session hook fails open; git hook per fail_mode | B3, B7 |

## 14. Build order

**Status:** steps 1–5 implemented (v0.1.0). B1–B12 are built and covered by
`tests/gate.test.sh` (80 assertions, no model in the loop). From the enterprise
layer, the policy resolver (B13) and its lock/strictest-wins merge are
implemented in `gate.js` because config resolution had to be correct from the
start; commit trailers (B15) are specified in `commands/review.md`; a
report-only CI companion (B16) ships in `ci/`. Not built: rulepack fetching
(B14), `/clean-code:sync` (B17), `/clean-code:calibrate` (B18), telemetry (B19).


1. **B1+B2** gate.js with a bash test suite (commit detection, review_id
   stability, marker lifecycle) — the deterministic core, testable without any model.
2. **B3+B5+B4** hook + review command + reviewer agent — the interactive path
   end-to-end.
3. **B10+B9** principles corpus, then skills as thin wrappers.
4. **B6+B7+B8** resume, git-native hook, setup.
5. README, banner, marketplace.json entry, version 0.1.0.

## 15. Open decisions (deferred, defaults chosen)

- Post-fix marker without re-review (chosen) vs. one cheap verification pass —
  revisit if applied fixes ever regress quality in practice.
- Advisory findings channel: shown inline at the gate (chosen) vs. suppressed.
- `auto_apply_trust` config (skip the question when only `fix.type=edit`
  blockers exist) — explicitly deferred until the gate has earned trust.
