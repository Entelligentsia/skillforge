# clean-code — Enterprise UX (layered rulesets + governance)

Premise: the usage semantics are frozen. A developer in an enterprise repo sees
the same UX as a solo user — silent gate when clean, one review, one question,
four options. Enterprise adds two orthogonal axes underneath:

1. **Rulesets** — *what* the reviewer judges (content). Layered and composable.
2. **Policy** — *what the gate permits* (constraints). Locked keys, bypass rules.

Content flows down and accumulates; constraints flow down and can only tighten.
A developer's personal config may always make the gate stricter, never weaker.

## 1. The layer model

```
┌─ org rulepack(s) ──────────────┐   published centrally, versioned, pinned
│  ┌─ team rulepack(s) ─────────┐│   e.g. packs/frontend, packs/payments
│  │  ┌─ repo policy file ─────┐││   tracked in the repo, team-owned
│  │  │  ┌─ personal local.md ┐│││   untracked, per-user
│  │  │  └────────────────────┘│││
│  │  └────────────────────────┘││
│  └────────────────────────────┘│
└────────────────────────────────┘
```

Two file kinds in the target repo:

- **`.claude/clean-code.policy.md`** — NEW, tracked in git, owned by the team
  (changes flow through PR review — governance rides on git itself, no new
  approval machinery). Declares rulepack pins, config values, and locks.
- **`.claude/clean-code.local.md`** — unchanged, untracked, personal. In an
  enterprise repo it becomes a *tightening overlay*: keys the policy locks are
  ignored (with a one-line notice), unlocked keys merge with
  "stricter-wins" semantics.

### 1.1 Rulepacks (content)

A rulepack is a versioned directory of principle files plus an optional config
fragment — exactly the shape of the plugin's own `docs/principles/`, published
separately:

```
org-clean-code-standards/            # a plain git repo, tagged releases
├── packs/
│   ├── base/                        # org-wide floor
│   │   ├── pack.yaml                # name, version, config fragment
│   │   └── principles/*.md
│   ├── frontend/                    # extends base
│   └── payments/                    # extends base; stricter error rules
```

Distribution is git, not a bespoke registry: the policy file pins
`<repo-url>@<tag>` per pack; the plugin shallow-clones into
`$(git rev-parse --git-dir)/clean-review/packs/<name>@<tag>/` on first use and
never re-fetches a pinned tag (content-addressed by tag; offline-safe after
first fetch). The reviewer agent receives the concatenated rubric:
org packs → team packs → repo policy body → personal body, in that order, each
section labeled with its source so findings can cite which layer's rule fired.

### 1.2 Policy file format

```markdown
---
rulepacks:
  - source: git@github.com:acme/clean-code-standards.git
    packs: [base, frontend]
    pin: v2.3.0
severity_threshold: major
fail_mode: closed
bypass: reason-required        # logged | reason-required | disabled
locked: [fail_mode, bypass, severity_threshold, rulepacks]
exclude:
  - "**/*.lock"
---
# Repo-specific rubric (tracked, PR-reviewed)
Domain layer must not import adapters. ...
```

Merge semantics, exactly:

| Key | Across layers |
|---|---|
| `severity_threshold` | strictest wins (`blocker` < `major`); locked = personal ignored |
| `exclude` | union of org+team+repo; personal may NOT add (excluding = weakening) unless policy sets `personal_excludes: allow` |
| `fail_mode` | `closed` wins; lockable |
| `bypass` | strictest wins (`disabled` > `reason-required` > `logged`) |
| rubric bodies | concatenated, all layers, source-labeled |
| `max_diff_lines`, `headless_timeout_s` | repo policy wins; personal may lower `max_diff_lines` only |

A locked key that a personal file tries to override produces one non-blocking
notice at gate time — visible, never silent, never fatal:
`clean-code: 'fail_mode' is locked by repo policy (personal value ignored)`.

## 2. What each persona experiences

### 2.1 Developer — nothing new to learn

Identical flow. Three visible deltas, all policy-driven:

- **Findings cite their layer**: `src/pay/refund.ts:88 — [payments@v2.3.0]
  monetary amounts must be integer cents`. Rules feel owned, not arbitrary,
  and "who do I argue with" has an answer (the pack's owning team).
- **Bypass reflects policy.** `bypass: reason-required` replaces the
  "Commit anyway" option with "Commit anyway (reason required)" — choosing it
  asks one free-text reason, which is written to the commit as a trailer:
  `Clean-Review: bypassed reason="hotfix INC-4412, cleanup in PR #892"`.
  `bypass: disabled` removes the option entirely; the gate's remaining exits
  are apply/manual (and the escape hatch is a PR label handled in CI, §3.2 —
  never a local override).
- **Setup asks less.** In a repo with a policy file, `/clean-code:setup`
  preflight shows *"Repo policy found (owner: CODEOWNERS → @acme/frontend-core);
  mandated settings will apply"* and the confirmation collapses to
  Install / Cancel — no per-setting choices for things policy has decided.
  `SKIP_CLEAN_REVIEW=1` under `bypass: disabled` is honored locally (we do not
  pretend a local hook is tamper-proof) but the commit lacks the review trailer,
  which CI will catch.

### 2.2 Team lead — ruleset author

- Edits `.claude/clean-code.policy.md` body or the team pack; both flow through
  ordinary PR review. Rubric changes are diffs colleagues can see and veto.
- `/clean-code:calibrate` (new, optional): replays the reviewer against the
  last N merged commits with the proposed rubric change and reports the finding
  delta — "this new rule would have fired 11 times last sprint" — before the
  rule ships. Prevents fatigue-inducing rules from landing blind.
- Promoting a repo rule to the team pack is a PR moving text from the policy
  body into `packs/<team>/principles/` — one file move, reviewed by pack owners.

### 2.3 Platform / governance owner

- Owns `org-clean-code-standards` and its `packs/base`. Tag = release;
  CODEOWNERS on the pack repo = approval workflow. No new infrastructure.
- **Rollout UX**: publishing `v2.4.0` does nothing to any repo (pins are
  explicit — a rubric change must never invisibly change gates org-wide).
  Adoption is `/clean-code:sync` per repo: shows the rubric diff between pinned
  and latest tag, estimated impact via calibrate, then opens the pin-bump PR.
  Teams that lag show up in the drift report, not in broken commits.
- **Visibility**: gate events (passed / fixes-applied / user-approved /
  bypassed, with review_id, repo, pack versions) POST to an optional
  `telemetry_url` (org-locked key; failure to POST NEVER blocks a commit —
  telemetry is observability, not enforcement). The commit trailers give a
  second, infrastructure-free audit surface queryable with plain `git log`.

## 3. Governance mechanics — where enforcement actually lives

### 3.1 The honest trust model

Local hooks are convenience enforcement; a hostile or hurried dev can bypass
anything on their own machine (`--no-verify`, env var, editing the hook).
Enterprise guarantee therefore lives in CI, and every governance feature is
designed so the local layer degrades to *visible* rather than *prevented*:

- Every gate outcome writes a commit trailer:
  `Clean-Review: passed id=<review_id> packs=base@v2.3.0,frontend@v2.3.0`
  (or `bypassed reason=…`). Forgeable — by design treated as telemetry, not proof.

### 3.2 CI companion job (the actual guarantee)

A reusable pipeline step (GitHub Action / GitLab template) shipped in
`ci/`: on each PR it recomputes the review over the PR diff with the repo's
pinned policy — same reviewer, same rubric, headless — and:

- passes silently when clean (mirror of the local UX);
- posts findings as PR review comments when not (same schema, same
  layer-labeled citations — the developer sees the *same finding text* they
  would have seen locally, which is what makes local adoption voluntary-but-
  rational: run it locally and CI stays quiet);
- treats missing/bypassed trailers per policy: `bypass: reason-required` → the
  reason surfaces in the PR conversation for human review; `bypass: disabled` →
  the check fails unless a designated PR label (e.g. `clean-review-exception`,
  grantable only by CODEOWNERS) is present — the audited escape hatch that
  keeps hotfixes shippable without blessing silent bypass.

### 3.3 Standardization without freezing teams

- `packs/base` is the org floor; team packs may add rules and raise strictness,
  never subtract (the resolver enforces this structurally: base always
  concatenates first and constraint keys merge strictest-wins).
- Team divergence is visible, not forbidden: the drift report lists each repo's
  pin lag and local-rule count. Governance by transparency first, `locked:`
  keys second, CI-fail last.

## 4. New building blocks (extends DESIGN.md inventory)

| # | Block | Kind | Role |
|---|---|---|---|
| B13 | Policy file + resolver | `.claude/clean-code.policy.md` (tracked) + resolver in gate.js/review | Layer merge, locks, strictest-wins |
| B14 | Rulepack fetcher | git shallow-clone by pin into state dir | Versioned org/team rubric distribution, offline-safe |
| B15 | Commit trailers | written on every gated commit | Infrastructure-free audit surface (`git log --grep`) |
| B16 | CI companion | `ci/` reusable action/template | The real enforcement + PR-comment findings |
| B17 | `/clean-code:sync` | command | Pin-bump UX: rubric diff + impact estimate + PR |
| B18 | `/clean-code:calibrate` | command | Replay proposed rules against recent history before shipping them |
| B19 | Telemetry emitter | optional POST in gate.js, org-locked URL | Dashboards; never blocks |

Deltas to existing blocks: gate.js `check` reads policy before local.md and
applies the merge table; the review command labels findings with source layer
and handles the three bypass modes at the AskUserQuestion gate; setup/remove
gain policy-awareness (setup collapses mandated choices; remove refuses to
delete the *tracked* policy file — that belongs to the team's git history).

## 5. Adoption path (matches how enterprises actually roll out)

1. Ship CI companion in **report-only** mode org-wide (comments, never fails).
2. Teams adopt locally via setup — voluntary, but it silences the CI comments.
3. Policy files land per-repo with `bypass: logged`; baseline pack pinned.
4. Ratchet per team readiness: `reason-required` → CI-enforced trailers →
   `disabled` + exception label for the repos that warrant it.

Each step changes only constraint values — never the daily flow, which is the
property that makes the ratchet politically survivable.
