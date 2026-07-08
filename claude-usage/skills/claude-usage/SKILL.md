---
name: claude-usage
description: >-
  Compute Claude Code token usage by model for any date range from local
  session transcripts. Use this whenever the user asks how many tokens they
  used, their Claude Code / Claude subscription usage, usage for a month or
  week or day, a "usage report", per-model token breakdown, or "how much did I
  spend/use" over some period — including phrasings like "first week of June",
  "last 7 days", "June 2026", or "yesterday". This is the right tool on the
  subscription plan, where console.anthropic.com does NOT show usage. Trigger
  even when the user just names a period and the word "usage" without saying
  "tokens".
---

# claude-usage

Reports Claude Code token usage grouped by model for a date range, read
straight from the local transcript files in `~/.claude/projects/`. On the
subscription plan this is the only place the numbers live — the API console
only covers pay-as-you-go API keys, not subscription sessions.

## How it works

Every assistant turn is logged to a `*.jsonl` transcript with a `message.usage`
block (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`) and an ISO `timestamp`. The bundled script walks all
transcripts — main sessions, subagents, and workflow runs — sums usage for
messages whose day falls in the requested range, and groups by model. Days are
bucketed in IST (`+05:30`) by default.

## Your job: turn the user's phrase into `--start` / `--end`, then run the script

The user gives a fuzzy period ("first week of June 2026"). You resolve it to two
inclusive ISO dates and call the script. Do the date reasoning yourself — the
script only accepts explicit `YYYY-MM-DD` bounds, which keeps the aggregation
deterministic.

Resolve common phrases like this (assume the current year if none is given; use
the current date from your context for relative ranges):

- **"June 2026"**, "in June", "the month of June" → `--start 2026-06-01 --end 2026-06-30`
- **"first week of June 2026"** → `--start 2026-06-01 --end 2026-06-07`
  (weeks are counted as day 1–7, 8–14, 15–21, 22–end unless the user clearly
  means calendar weeks starting Monday — if ambiguous, state the assumption)
- **"second week of June 2026"** → `--start 2026-06-08 --end 2026-06-14`
- **"June 21–30"** → `--start 2026-06-21 --end 2026-06-30`
- **"last 7 days"** → the 7 days ending today (inclusive)
- **"this month"** → first of the current month through today
- **"yesterday"** → that single day as both start and end
- A single day ("on 2026-06-15") → same date for `--start` and `--end`

When a phrase is genuinely ambiguous (e.g. "last week" near a month boundary),
pick the most natural reading, run it, and say which range you used so the user
can correct you.

## Running it

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/claude-usage/scripts/compute_usage.js" \
  --start 2026-06-01 --end 2026-06-07
```

`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's install directory in-session.
If it isn't set (e.g. running the script from a plain terminal), locate it with:
`find "$HOME/.claude/plugins" -path '*claude-usage/scripts/compute_usage.js' | head -1`.

Useful flags:

- `--daily` — add a per-day, per-model breakdown under the summary table.
- `--cost` — add a USD cost table priced at **Anthropic API list rates**
  (`scripts/pricing.json`), so the user sees what the same usage would cost
  pay-as-you-go. Cache-creation tokens are priced at **each entry's real TTL** —
  the `usage` block records `cache_creation.ephemeral_5m_input_tokens` /
  `ephemeral_1h_input_tokens`, so 5-minute writes bill ×1.25 and 1-hour writes
  ×2 of input, exactly as incurred. `--cache-ttl 1h|5m` only sets the fallback
  for the rare entry with no TTL breakdown (default 1h). Local / non-Anthropic
  models (Ollama/GLM/etc.) are shown as *unpriced* and excluded from the total.
  Always say this is the *equivalent* API cost — subscription usage is flat-rate,
  not billed per token. When the user asks "how much did I use" they often mean
  cost — offer or include `--cost`.
- `--format json` — machine-readable (for piping into another report or an
  artifact); `--format csv` for spreadsheets. Both include cost when `--cost`
  is set.
- `--tz UTC` (or `-08:00`, etc.) — bucket days in a different timezone. Default
  is `+05:30` (IST) to match the user's preference.
- `--raw` (alias `--no-dedupe`) — **dedupe is ON by default.** The scan counts
  each distinct `message.id` once, because resumed/compacted sessions and
  subagent trees replay the same assistant responses (same id) into multiple
  transcript files — on real data this roughly halves the token count, and the
  deduped number is the accurate measure of actual model consumption. Use
  `--raw` only when you specifically want the inflated on-disk line count.
- `--verbose` — log matching files to stderr while scanning (progress only).

The scan reads every transcript on disk, so it can take a few seconds and print
nothing until done — that's expected. Use `--verbose` if you want progress.

## Reading the output

The default table has one row per model plus a TOTAL:

- **Input / Output** — tokens you sent and the model returned. **Total = Input +
  Output**; this is the headline "how much did I use" number.
- **CacheCreate / CacheRead** — prompt-cache tokens. A very large CacheRead
  relative to Input is normal and good: it means long system prompts and
  context were reused cheaply rather than re-billed as fresh input.

Present the result as a short table and call out the dominant model and the
active-day count. If the user asked for a specific slice (a week, a day), lead
with that total. Keep it concise — this is a lookup, not an essay.

## Pricing

Rates live in `scripts/pricing.json` (USD per million tokens, input + output,
per model id) plus the cache multipliers (5-min write ×1.25, 1-hour write ×2,
read ×0.1 of input — Anthropic's standard prompt-caching structure). Each cached
write is priced at the TTL the transcript actually records
(`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), not
a blanket assumption. Model ids match by longest prefix, so dated snapshots fold
into their family. Sonnet 5
introductory pricing ($2/$10 through 2026-08-31) is applied automatically when
the whole range falls in that window. **Verify the rates against
platform.claude.com/pricing before quoting a figure the user will act on** —
list prices change, and this file is a point-in-time snapshot (last verified in
the `_comment`). Update the JSON rather than the script when prices move.

## Notes and limits

- Only data still on disk is counted. Claude Code prunes old transcripts, so
  very old ranges may be partial or empty — say so rather than reporting a
  suspiciously low number as if complete.
- `<synthetic>` rows are local placeholder messages with zero tokens; harmless.
- Local/non-Claude models (Ollama, GLM, etc.) that ran through Claude Code also
  appear, labeled by their model id — useful, but not part of Claude
  subscription usage. Separate them if the user specifically wants Claude only.
