---
name: lean-ctx-eval
description: Evaluate whether the lean-ctx MCP is saving more context tokens than it costs, for the current project, using that project's Claude Code session transcripts. Measures ctx_read with a per-call counterfactual vs native Read, compares ctx_shell against native Bash observationally, nets out the per-session instruction+schema tax, and reports a token ledger. Use when asked to eval lean-ctx, measure context-compression savings, audit token usage of an MCP, or decide if lean-ctx earns its seat.
---

# lean-ctx-eval

Produces a data-grounded token ledger for the lean-ctx MCP from your Claude Code
session transcripts (`~/.claude/projects/<encoded-cwd>/`). Read-only; it never
re-executes any recorded shell command.

## Run it

**1. Locate the bundled script** (works whether or not `CLAUDE_PLUGIN_ROOT` is set):

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT:-}/scripts/lean_ctx_eval.py"
[ -f "$SCRIPT" ] || SCRIPT="$(find "$HOME/.claude/plugins" -path '*lean-ctx-eval/scripts/lean_ctx_eval.py' 2>/dev/null | head -1)"
echo "script: $SCRIPT"
```

**2. Ensure the tokenizer venv** (durable, one-time, in the user cache — the script
still runs without it via a char/4 fallback, just ~10% noisier):

```bash
VENV="$HOME/.cache/lean-ctx-eval/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV" && "$VENV/bin/pip" install -q tiktoken
fi
PY="$VENV/bin/python"; [ -x "$PY" ] || PY=python3
```

**3. Evaluate the current project** (default scope = current working dir):

```bash
"$PY" "$SCRIPT" --cwd "$PWD" --out "/tmp/lean_ctx_eval_$$"
```

It prints a Markdown report and writes `<out>.md` + `<out>.json`. **Relay the report**,
leading with the **net ledger** line and the **ctx_read by-mode table**.

## Arguments
- `--cwd <path>` — project to evaluate (default: current dir); mapped to its transcript
  dir by replacing `/` and `.` with `-`.
- `--project <dirname>` — target a specific `~/.claude/projects` dir explicitly.
- `--all` — evaluate the whole transcript corpus instead of one project.
- `--baseline {global,project}` — source of the native-Bash baseline for ctx_shell
  (default `global` = more data; `project` = like-for-like).
- `--schema-tax-tokens N` — per-session core-tool schema cost (default 1800, measured
  from lean-ctx source: 11 core tools). `0` to ignore; higher for a sensitivity run.
- `--filter <substr>` — restrict to sessions whose path contains the substring.

## What it measures (explain when asked)
- **ctx_read — causal per-call counterfactual.** native `cat -n {path}` (sliced to the
  mode's line range) vs the realized payload stored in the transcript. Files modified
  after the session are **excluded as stale** and reported separately — never counted
  as savings. Broken out by mode (full/map/signatures/lines:*) and stub-vs-content.
- **ctx_shell — observational baseline.** Old commands can't be safely re-run, so
  ctx_shell payload sizes are compared to native `Bash` results from non-lean-ctx
  sessions, bucketed by command head. Labeled associational; **kept out of the ledger**.
- **Overhead.** Per-session instruction block (measured in transcript) + core-tool
  schema tax (constant from source).
- **Net ledger** = ctx_read saved − instruction tax − schema tax.

## Caveats to state in the summary
- ctx_shell numbers are associational, not causal.
- Stale reads are dropped (often the largest sample loss in active repos), so the
  per-project absolute ledger is conservative; the savings % on the measured subset
  still holds.
- Token counts use tiktoken `o200k_base`; Claude's tokenizer differs, so absolute
  figures are ±~10% — use for relative comparison.
- Independent of lean-ctx's own `token_report`/`ctx_benchmark` — this eval does not
  trust the vendor's self-measurement.
