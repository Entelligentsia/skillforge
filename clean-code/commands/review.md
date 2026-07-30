---
description: "Review the staged diff for clean-code violations, present findings for one decision, and satisfy the commit gate"
allowed-tools: ["Bash", "Read", "Edit", "Grep", "Glob", "Task", "AskUserQuestion"]
---

Run the clean-code review over the staged diff and resolve the commit gate.

`${CLAUDE_PLUGIN_ROOT}/hooks/gate.js` is referred to below as **the gate**. Every
decision the gate makes is deterministic — never second-guess it, never write
marker files by hand, and never edit anything under `.git/clean-review/`.

## S0 — Collect

1. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" status`. If `state` is
   `dormant` or `paused`, tell the user the gate is not active in this repo
   (suggest `/clean-code:setup` for dormant) and stop.
2. If `reviewed` is already `true`, the staged tree passed the gate earlier.
   Say so in one line, go straight to S5, and do not review again.
3. Read the resolved rubric: `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" config`
   gives the config and any repo-policy/personal rubric bodies.
4. Get the filtered diff: `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" diff`.
   This has the configured excludes already applied — do not run
   `git diff --staged` yourself.
5. If the diff exceeds `max_diff_lines`, do not silently review a subset. Say
   how large it is and offer, via AskUserQuestion: review the largest-risk files
   only (name them) / review everything anyway (slower) / bypass this commit
   with a recorded reason.

## S1 — Review

Spawn the `clean-code-reviewer` agent with the Task tool. Give it exactly:

- the filtered diff from S0,
- the rubric: the principle files in `${CLAUDE_PLUGIN_ROOT}/docs/principles/`
  (base layer), then the repo policy body, then the personal body — each
  section labelled with its source,
- the repo root path.

Tell the user in one line that the review is running. Parse the agent's JSON
reply. If it is not valid JSON, retry the agent once; if it fails again, report
the failure and offer the S3 options minus "Apply" — never fabricate findings,
and never mark the gate on a failed review.

## S2 — No gating findings

Gating findings are those with `severity` at or above the configured
`severity_threshold` **and** `confidence: high`. Everything else is advisory.

If there are no gating findings:

1. `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" mark passed`
2. Print one line: `Clean-code review passed — committing.` Add advisory items
   only if any exist, as a short list below that line, and do not ask about them.
3. Go to S5.

Do not congratulate, summarise the diff, or explain what you reviewed. Silence
on success is the point.

## S3 — The gate (findings exist)

You **must** present the findings through AskUserQuestion. Do not decide on the
user's behalf, do not apply fixes first and ask after, and do not retry the
commit while findings are unresolved.

Before asking, print the findings as a readable list — one entry each:

```
src/auth.ts:142 — [base] validateAndSaveUser does validation, persistence, and email dispatch
    A reviewer would block: the three concerns cannot be tested or changed independently.
    Fix: extract validateUser and sendWelcomeEmail; leave saveUser as the persistence step.
```

Then ask exactly one question with these options, in this order:

| Option | Label |
|---|---|
| 1 | `Apply all fixes` — only when every gating finding has `fix.type: edit` |
| 2 | `Apply selected` — set `multiSelect: true` when offering this |
| 3 | `I'll fix manually` |
| 4 | `Commit anyway` — see bypass modes below |

Bypass mode comes from the resolved config's `bypass` key:

- `logged` (default): label the option `Commit anyway`.
- `reason-required`: label it `Commit anyway (reason required)`. If chosen, ask
  for a one-line reason and pass it to the gate.
- `disabled`: **omit option 4 entirely.** Tell the user repo policy disables
  local bypass and that the exception path is a CODEOWNERS-granted PR label.

## S4 — Act on the answer

### S4a — Apply all / Apply selected

1. Before editing, check whether any file you are about to touch has unstaged
   changes (`git diff --name-only`). If so, warn in the summary that staging the
   fix will also stage those pre-existing edits — the user may want to abort.
2. Apply each selected fix with Edit. Fix only what the finding describes;
   opportunistic cleanups are out of scope and erode trust in "Apply all".
3. `git add` each file you edited.
4. Print a compact summary of what changed — file, line, one clause. Do **not**
   ask a second question; the user already consented.
5. `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" mark fixes-applied`. The marker
   binds to the post-fix tree, so the retry passes without re-reviewing.
6. Go to S5.

If some findings were `fix.type: advice` and were not selected, list them as
remaining work in the summary.

### S4b — I'll fix manually

1. Write the findings to pending state:
   `echo '<findings JSON array>' | node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" pending write`
2. Do **not** mark the gate and do **not** retry the commit.
3. End your turn with the findings as a `file:line — summary` checklist. The
   user is about to leave the conversation to edit; that list is what they take
   with them. Tell them that after fixing they can commit again (the gate
   re-reviews the changed diff) or run `/clean-code:resume`.

### S4c — Commit anyway

1. With `bypass: reason-required`, capture the reason first.
2. `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" mark user-approved '{"reason":"<reason or empty>"}'`
3. Go to S5.

## S5 — Complete the commit

1. `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" pending clear`
2. Retry the commit command that was blocked, unchanged apart from trailers.
   If you do not know it, ask the user for the commit message rather than
   inventing one.
3. Append a trailer to the commit message recording the outcome, on its own line
   after a blank line:
   - `Clean-Review: passed id=<review_id>`
   - `Clean-Review: fixes-applied id=<review_id>`
   - `Clean-Review: bypassed id=<review_id> reason="<reason>"`
   Get `<review_id>` from `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" hash`
   **before** committing.
4. If the gate denies the commit again, something is inconsistent — report the
   gate's reason verbatim and stop. Do not loop, and do not bypass to escape it.

## Rules that override everything above

- Never bypass the gate on your own initiative. Bypass is a user decision.
- Never mark the gate before the review has actually run and returned findings.
- Never use `--no-verify`.
- If the user interrupts mid-flow, leave the state as it is; the gate is
  idempotent and the next attempt resumes correctly.
