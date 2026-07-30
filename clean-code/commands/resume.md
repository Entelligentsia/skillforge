---
description: "Re-open the clean-code review gate from findings saved earlier, without re-running the review"
allowed-tools: ["Bash", "Read", "Edit", "AskUserQuestion"]
---

Resume triage of clean-code findings that were saved but never resolved — after
choosing "I'll fix manually", or after a blocked commit from the terminal.

## Step 1 — Load pending findings

Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.js" pending read`.

- `present: false` → there is nothing to resume. If the staged tree is
  unreviewed, offer to run `/clean-code:review` instead; otherwise say the gate
  is already satisfied and stop.
- `stale: true` → the staged content changed since those findings were written,
  so they may no longer apply. Say exactly that, then run `/clean-code:review`
  from S0 for a fresh review. Do not present stale findings as current.
- `stale: false` → the findings still describe the staged tree. Continue.

## Step 2 — Re-enter the gate

Present the loaded findings exactly as `/clean-code:review` step S3 specifies —
same readable list, same AskUserQuestion options, same bypass-mode handling from
the resolved config. Do not re-run the reviewer agent: these findings were
already paid for, and re-reviewing identical content wastes the user's time.

## Step 3 — Act

Follow `/clean-code:review` steps S4 and S5 unchanged. The only difference from
a fresh review is where the findings came from.

If the user fixed some issues manually since the findings were saved, the tree
would have changed and step 1 would have reported `stale` — so trust the
findings when they are fresh, and trust the re-review when they are not.
