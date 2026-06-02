# lean-ctx-eval

A data-grounded eval for the [lean-ctx](https://github.com/lean-ctx) MCP server:
**is it actually saving more context tokens than it costs?** Answered from your own
Claude Code session transcripts — not the vendor's self-reported numbers.

## Skills

| Skill | Trigger |
|-------|---------|
| [`lean-ctx-eval`](skills/lean-ctx-eval/SKILL.md) | "eval lean-ctx", "measure context-compression savings", "is lean-ctx worth it?", auditing an MCP's token usage |

## What it does

Scans `~/.claude/projects/<current-project>/*.jsonl`, pairs every `tool_use` with its
`tool_result`, and computes a **net token ledger** focused on the two tools that
dominate real usage (`ctx_read` + `ctx_shell`).

| Component | Method | In the ledger? |
|-----------|--------|----------------|
| **ctx_read** | Per-call counterfactual: native `cat -n {path}` (mode-sliced) vs the realized payload in the transcript. Stale files (modified after the session) excluded. | ✅ causal |
| **ctx_shell** | Observational: ctx_shell output sizes vs native `Bash` output from non-lean-ctx sessions, bucketed by command head. Cannot safely re-run old commands. | ❌ associational |
| **Overhead** | Per-session instruction block (measured) + 11 core-tool schemas (~1800 tok, measured from lean-ctx source). | ✅ cost |

**Net = ctx_read saved − instruction tax − schema tax.**

## Install

```
/plugin marketplace add Entelligentsia/skillforge
/plugin install lean-ctx-eval@skillforge
```

Then, from inside any project you've used lean-ctx in:

> eval lean-ctx for this project

or run the bundled script directly:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lean_ctx_eval.py --cwd "$PWD" --out /tmp/report
```

(Install `tiktoken` for accurate token counts; without it the script falls back to a
char/4 estimate.)

## Design principles

- **Counterfactual, not vendor metrics.** Compares against what native `Read`/`Bash`
  *would* have injected, reconstructed from disk — independent of lean-ctx's own
  `token_report`.
- **No silent inflation.** Shell numbers are observational and excluded from the
  ledger; stale reads are reported, never counted as savings.
- **Read-only.** Never re-executes a recorded command.
- **Honest precision.** tiktoken `o200k_base` ≠ Claude's tokenizer, so absolute figures
  are ±~10%; the tool is for relative, decision-grade comparison.

## License

MIT © Entelligentsia
