# claude-usage

Report Claude Code **token usage** and **equivalent Anthropic API cost** by
model for any date range, read straight from the local session transcripts in
`~/.claude/projects/`. On the subscription plan this is the only place the
numbers live — `console.anthropic.com` only shows pay-as-you-go API-key usage,
not subscription sessions.

## Why

Claude Code's built-in stats cache stops updating and doesn't break down cost.
This skill parses every transcript on disk — main sessions, subagents, and
workflow runs — and gives you an auditable per-model breakdown for whatever
window you ask about, in plain English ("first week of June", "last 7 days",
"July 1 to now").

## Install

Add the SkillForge marketplace, then install the plugin:

```
/plugin marketplace add Entelligentsia/skillforge
/plugin install claude-usage@skillforge
```

## Use

Invoke `/claude-usage` with a period. The skill resolves the phrase to explicit
dates and runs the bundled aggregator.

```
/claude-usage June 2026
/claude-usage first week of June 2026 with cost
/claude-usage last 7 days
/claude-usage July 1 to now, by model and token buckets and cost
```

Or run the script directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/claude-usage/scripts/compute_usage.js" \
  --start 2026-07-01 --end 2026-07-08 --cost
```

## What you get

- **Per-model token buckets** — input, output, cache-create, cache-read, total.
- **Equivalent API cost** (`--cost`) at Anthropic list rates
  (`scripts/pricing.json`), with cache-creation priced at each entry's **real
  TTL** (5-minute writes ×1.25, 1-hour ×2 of input, from the transcript's
  `cache_creation.ephemeral_5m/1h_input_tokens`). Subscription usage is
  flat-rate — this is the *equivalent* pay-as-you-go cost, not a bill.
- **Accurate de-duplication (default)** — counts each distinct `message.id`
  once, so responses replayed across resumed/compacted sessions and subagent
  trees aren't double-counted. `--raw` gives the on-disk line count.

Flags: `--daily`, `--cost`, `--cache-ttl 1h|5m`, `--format json|csv`,
`--tz +05:30`, `--raw`, `--verbose`. Days bucket in IST (`+05:30`) by default;
override with `--tz`.

## Maintaining pricing

`scripts/pricing.json` is a point-in-time snapshot of Anthropic list prices
(USD per million tokens, per model, plus cache multipliers). When prices change,
edit the JSON — not the script — and update the `_comment` verification date.
Local / non-Anthropic models (Ollama, GLM, etc.) are intentionally absent and
reported as *unpriced*.
