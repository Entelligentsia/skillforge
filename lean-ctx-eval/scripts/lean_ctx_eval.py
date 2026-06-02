#!/usr/bin/env python3
"""
lean_ctx_eval.py — Data-grounded eval: is the lean-ctx MCP doing anything useful?

Focus: ctx_read + ctx_shell only.

Method (see proposal):
  1. ctx_read  -> per-call counterfactual. realized payload tokens (from transcript)
                  vs native `cat -n {path}` tokens (read-only, at rest), mode-sliced.
                  Files whose mtime is AFTER the session timestamp are flagged STALE
                  and excluded from the savings ledger (reported separately).
  2. ctx_shell -> observational baseline. Compare ctx_shell payload tokens against
                  native Bash tool_result tokens mined from non-lean-ctx sessions,
                  bucketed by command head. Associational, never re-executed.
  3. overhead  -> per-session lean-ctx instruction/schema token tax, amortized.
  4. backfire  -> fresh=true / raw=true / native fallback / errors after a ctx_ call.
  5. ledger    -> net = read_saved - overhead - (shell baseline delta is informational).

Token counting: tiktoken o200k_base (offline). Read-only; no shell re-execution.
"""
import json, os, re, sys, glob, argparse, statistics as st
from collections import defaultdict, Counter

# ---- tokenizer ----------------------------------------------------------
try:
    import tiktoken
    _ENC = tiktoken.get_encoding("o200k_base")
    def ntok(s): return len(_ENC.encode(s or "", disallowed_special=()))
    TOKMODE = "tiktoken/o200k_base"
except Exception:
    def ntok(s): return (len(s or "") + 3) // 4
    TOKMODE = "char/4 fallback"

PROJECTS = os.path.expanduser("~/.claude/projects")
LEANCTX_RE = re.compile(r'mcp__lean-ctx__')

# ---- transcript parsing -------------------------------------------------
def iter_lines(fp):
    with open(fp, errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue

def block_text(content):
    """tool_result content -> plain text (str or list-of-blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""

def session_of(fp):
    """(project, session_id) — subagents/workflows roll into the parent session."""
    rel = os.path.relpath(fp, PROJECTS)
    parts = rel.split(os.sep)
    project = parts[0]
    rest = os.sep.join(parts[1:])
    sess = re.split(r'/subagents', rest)[0]
    sess = re.sub(r'\.jsonl$', '', sess)
    return project, sess

def first_ts(fp):
    for d in iter_lines(fp):
        ts = d.get("timestamp")
        if ts:
            return ts
    return None

def ts_epoch(ts):
    if not ts:
        return None
    try:
        import datetime as dt
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

# ---- pairing tool_use -> tool_result ------------------------------------
def extract_calls(fp):
    """Yield dicts: {tool, input, result_text, ts} for every tool call w/ a result."""
    uses = {}
    out = []
    for d in iter_lines(fp):
        msg = d.get("message")
        if not isinstance(msg, dict):
            continue
        ts = d.get("timestamp")
        for b in (msg.get("content") or []):
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                uses[b.get("id")] = (b.get("name"), b.get("input") or {}, ts)
            elif b.get("type") == "tool_result":
                tid = b.get("tool_use_id")
                if tid in uses:
                    name, inp, uts = uses[tid]
                    out.append({
                        "tool": name, "input": inp, "ts": uts,
                        "result_text": block_text(b.get("content")),
                        "is_error": bool(b.get("is_error")),
                    })
    return out

# ---- counterfactual for ctx_read ----------------------------------------
def parse_line_range(mode):
    """'lines:N-M' / 'lines:N,M' / 'lines:N' -> (start,end) 1-based inclusive, or None."""
    if not mode or not mode.startswith("lines:"):
        return None
    spec = mode[len("lines:"):]
    m = re.match(r'^(\d+)\s*[-,]\s*(\d+)$', spec)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return (min(a, b), max(a, b))
    m = re.match(r'^(\d+)$', spec)
    if m:
        return (int(m.group(1)), int(m.group(1)))
    return None

def native_read_tokens(path, mode, sess_epoch):
    """Tokens that native Read (cat -n) would have injected. Returns (tokens, status)."""
    if not path or not os.path.isfile(path):
        return None, "missing"
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None, "missing"
    stale = (sess_epoch is not None and mtime > sess_epoch + 1)
    try:
        with open(path, errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None, "unreadable"
    rng = parse_line_range(mode)
    if rng:
        a, b = rng
        lines = lines[a - 1:b]
    # native Read uses "    N\t" line-number prefix (cat -n style)
    numbered = "".join(f"{i:6d}\t{ln}" for i, ln in enumerate(lines, 1))
    return ntok(numbered), ("stale" if stale else "ok")

def cmd_head(command):
    """Normalize a shell command to a coarse bucket by its leading verb."""
    if not command:
        return "(empty)"
    c = command.strip()
    # strip env assignments / leading cd
    c = re.sub(r'^(cd\s+\S+\s*(&&|;)\s*)+', '', c)
    tok = re.split(r'\s+', c.strip())[0] if c.strip() else "(empty)"
    tok = os.path.basename(tok)
    # collapse common multi-word verbs
    second = ""
    parts = re.split(r'\s+', c.strip())
    if len(parts) > 1 and tok in ("git", "npm", "node", "yarn", "pnpm", "cargo", "go", "python3", "python"):
        second = re.sub(r'[^a-zA-Z0-9_.-]', '', parts[1])[:20]
        return f"{tok} {second}"
    return tok

# ---- main analysis ------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", default=PROJECTS)
    ap.add_argument("--filter", default=None, help="only sessions whose path contains this")
    ap.add_argument("--cwd", default=os.getcwd(),
                    help="project working dir; mapped to its Claude Code transcript dir "
                         "(default: current dir). lean-ctx analysis is scoped to it.")
    ap.add_argument("--project", default=None,
                    help="explicit transcript dir name under ~/.claude/projects "
                         "(overrides --cwd)")
    ap.add_argument("--all", action="store_true",
                    help="analyze the whole corpus, not just the current project")
    ap.add_argument("--baseline", choices=["global", "project"], default="global",
                    help="source of native-Bash baseline for ctx_shell (default global)")
    ap.add_argument("--out", default="lean_ctx_eval_report")
    # Grounded from source: 11 CORE_TOOL_NAMES granular schemas (~1800 tok); the
    # other ~50 tools load lazily via discover_tools, so they are NOT a per-session
    # cost. NOT stored in transcripts (lives in the API request `tools` array).
    ap.add_argument("--schema-tax-tokens", type=int, default=1800,
                    help="Per-session fixed cost of the 11 core lean-ctx tool schemas "
                         "in the API request. Default 1800 (measured from source). "
                         "Set 0 to ignore, or higher for a sensitivity scenario.")
    args = ap.parse_args()

    def encode_cwd(p):
        return re.sub(r'[/.]', '-', os.path.abspath(p))

    corpus = glob.glob(os.path.join(args.projects, "**", "*.jsonl"), recursive=True)

    # ---- resolve which files are the lean-ctx analysis SCOPE (current project default)
    scope_label = "ALL PROJECTS"
    if args.all:
        lean_scope = corpus
    else:
        if args.project:
            target = os.path.join(args.projects, args.project)
        else:
            target = os.path.join(args.projects, encode_cwd(args.cwd))
        if os.path.isdir(target):
            lean_scope = glob.glob(os.path.join(target, "**", "*.jsonl"), recursive=True)
            scope_label = os.path.basename(target)
        else:
            print(f"[!] No transcript dir for project: {target}")
            print(f"    (cwd={args.cwd}). Not a Claude Code project, or no sessions yet.")
            print(f"    Use --all for the whole corpus, or --project <dirname>.")
            # still allow: maybe match by recorded cwd field
            lean_scope = [f for f in corpus
                          if encode_cwd(args.cwd).strip('-') in f]
            if not lean_scope:
                sys.exit(2)
            scope_label = "(matched by cwd)"

    # native baseline source for ctx_shell
    baseline_corpus = lean_scope if args.baseline == "project" else corpus

    if args.filter:
        lean_scope = [f for f in lean_scope if args.filter in f]

    def has_leanctx(f):
        try:
            with open(f, errors="replace") as fh:
                for line in fh:
                    if '"mcp__lean-ctx__' in line:
                        return True
        except Exception:
            pass
        return False

    # lean-ctx files = scope sessions that actually invoke ctx_ tools
    lean_files = [f for f in lean_scope if has_leanctx(f)]
    # native baseline = sessions WITHOUT lean-ctx, from chosen baseline corpus
    native_files = [f for f in baseline_corpus if not has_leanctx(f)]

    # ---- 1+4: walk lean-ctx files: ctx_read counterfactual, ctx_shell sizes, backfire
    read_rows = []          # per ctx_read call
    shell_lean = defaultdict(list)   # bucket -> [tokens]
    per_session = defaultdict(lambda: {"read_calls": 0, "shell_calls": 0,
                                       "read_saved": 0, "read_realized": 0,
                                       "read_native": 0, "stale": 0, "missing": 0,
                                       "backfire": 0, "errors": 0})
    sess_epoch_cache = {}

    for f in lean_files:
        proj, sess = session_of(f)
        key = f"{proj}|{sess}"
        if key not in sess_epoch_cache:
            sess_epoch_cache[key] = ts_epoch(first_ts(f))
        sess_epoch = sess_epoch_cache[key]
        calls = extract_calls(f)
        for i, c in enumerate(calls):
            name = c["tool"] or ""
            ps = per_session[key]
            if "ctx_read" in name:
                ps["read_calls"] += 1
                realized = ntok(c["result_text"])
                ps["read_realized"] += realized
                mode = c["input"].get("mode", "full")
                path = c["input"].get("path")
                native, status = native_read_tokens(path, mode, sess_epoch)
                is_stub = ("use cached context" in c["result_text"]
                           or "unchanged" in c["result_text"][:120])
                if status == "missing":
                    ps["missing"] += 1
                elif status == "stale":
                    ps["stale"] += 1
                if c["is_error"]:
                    ps["errors"] += 1
                if native is not None and status == "ok":
                    saved = native - realized
                    ps["read_saved"] += saved
                    ps["read_native"] += native
                    read_rows.append({"mode": mode, "stub": is_stub,
                                      "realized": realized, "native": native,
                                      "saved": saved})
            elif "ctx_shell" in name:
                ps["shell_calls"] += 1
                realized = ntok(c["result_text"])
                bucket = cmd_head(c["input"].get("command", ""))
                shell_lean[bucket].append(realized)
                if c["input"].get("raw") or c["input"].get("fresh"):
                    ps["backfire"] += 1
                if c["is_error"]:
                    ps["errors"] += 1
            # backfire: native Read/Bash immediately after a ctx_ call on same target
            if "lean-ctx" not in name and i > 0:
                prev = calls[i - 1]["tool"] or ""
                if "lean-ctx" in prev and name in ("Read", "Bash"):
                    per_session[key]["backfire"] += 1

    # ---- 2: native Bash baseline from non-lean-ctx sessions
    shell_native = defaultdict(list)
    for f in native_files:
        for c in extract_calls(f):
            if (c["tool"] or "") == "Bash":
                bucket = cmd_head(c["input"].get("command", ""))
                shell_native[bucket].append(ntok(c["result_text"]))

    # ---- 3: overhead — lean-ctx tax per session = instruction block (in-transcript)
    #         + core tool schemas (constant, from source; not in transcript)
    instr_tok = []   # measured per top-level session
    for f in lean_files:
        if "/subagents" in os.path.relpath(f, args.projects):
            continue  # count once per top-level session
        tax = 0
        with open(f, errors="replace") as fh:
            for line in fh:
                if "ALWAYS use lean-ctx" not in line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                txt = ""
                for k in ("content", "text"):
                    v = d.get(k)
                    if isinstance(v, str):
                        txt += v
                    elif isinstance(v, list):
                        txt += block_text(v)
                if not txt:
                    txt = json.dumps(d)
                tax = max(tax, ntok(txt))
        if tax:
            instr_tok.append(tax)
    # distinct top-level lean-ctx sessions (schema tax applies once each)
    n_sessions = len({session_of(f) for f in lean_files
                      if "/subagents" not in os.path.relpath(f, args.projects)})
    schema_total = args.schema_tax_tokens * n_sessions
    overhead_total = sum(instr_tok) + schema_total
    overhead_tok = instr_tok  # for median reporting

    # ---- assemble report ----------------------------------------------
    def med(a): return int(st.median(a)) if a else 0
    def total(a): return sum(a)

    by_mode = defaultdict(lambda: {"n": 0, "realized": 0, "native": 0, "saved": 0})
    for r in read_rows:
        m = "lines:*" if r["mode"].startswith("lines:") else r["mode"]
        b = by_mode[m]
        b["n"] += 1; b["realized"] += r["realized"]
        b["native"] += r["native"]; b["saved"] += r["saved"]
    stub_rows = [r for r in read_rows if r["stub"]]
    content_rows = [r for r in read_rows if not r["stub"]]

    shell_cmp = []
    for bucket in sorted(set(shell_lean) | set(shell_native),
                         key=lambda b: -len(shell_lean.get(b, []))):
        ln = shell_lean.get(bucket, [])
        nv = shell_native.get(bucket, [])
        if len(ln) < 3:
            continue
        shell_cmp.append({
            "bucket": bucket, "lean_n": len(ln), "lean_median": med(ln),
            "native_n": len(nv), "native_median": med(nv),
            "delta_median": (med(nv) - med(ln)) if nv else None,
        })

    tot_read_saved = sum(r["saved"] for r in read_rows)
    tot_read_native = sum(r["native"] for r in read_rows)
    tot_read_realized = sum(r["realized"] for r in read_rows)

    report = {
        "tokenizer": TOKMODE,
        "files": {"lean_ctx_sessions": len(lean_files), "native_sessions": len(native_files)},
        "ctx_read": {
            "calls_with_counterfactual": len(read_rows),
            "native_tokens_total": tot_read_native,
            "realized_tokens_total": tot_read_realized,
            "tokens_saved_total": tot_read_saved,
            "savings_pct": round(100 * tot_read_saved / tot_read_native, 1) if tot_read_native else 0,
            "stub_reads": {"n": len(stub_rows),
                           "native": sum(r["native"] for r in stub_rows),
                           "realized": sum(r["realized"] for r in stub_rows),
                           "saved": sum(r["saved"] for r in stub_rows)},
            "content_reads": {"n": len(content_rows),
                              "native": sum(r["native"] for r in content_rows),
                              "realized": sum(r["realized"] for r in content_rows),
                              "saved": sum(r["saved"] for r in content_rows)},
            "by_mode": {m: v for m, v in sorted(by_mode.items(), key=lambda kv: -kv[1]["saved"])},
            "excluded": {
                "stale": sum(ps["stale"] for ps in per_session.values()),
                "missing": sum(ps["missing"] for ps in per_session.values()),
            },
        },
        "ctx_shell": {
            "total_calls": sum(len(v) for v in shell_lean.values()),
            "overall_median_tokens": med([x for v in shell_lean.values() for x in v]),
            "by_command_bucket_vs_native": shell_cmp,
        },
        "overhead": {
            "lean_ctx_sessions": n_sessions,
            "instruction_block_median_tok": med(overhead_tok),
            "instruction_block_total_tok": sum(overhead_tok),
            "schema_tax_per_session_tok": args.schema_tax_tokens,
            "schema_tax_total_tok": schema_total,
            "total_tax_tokens": overhead_total,
        },
        "backfire": {
            "total_events": sum(ps["backfire"] for ps in per_session.values()),
            "errors": sum(ps["errors"] for ps in per_session.values()),
        },
        "net_ledger": {
            "read_saved": tot_read_saved,
            "minus_overhead_tax": -overhead_total,
            "net_tokens": tot_read_saved - overhead_total,
            "note": "ctx_shell excluded from ledger (observational only); see by_command_bucket.",
        },
    }

    with open(args.out + ".json", "w") as fh:
        json.dump(report, fh, indent=2)

    # ---- markdown ----
    md = []
    md.append(f"# lean-ctx eval — ctx_read + ctx_shell\n")
    md.append(f"**scope: {scope_label}** · baseline: {args.baseline}\n")
    md.append(f"_tokenizer: {TOKMODE} · {len(lean_files)} lean-ctx files, {len(native_files)} native baseline files_\n")
    r = report["ctx_read"]
    md.append("## ctx_read — per-call counterfactual (native `cat -n` vs realized)\n")
    md.append(f"- calls counted: **{r['calls_with_counterfactual']}** "
              f"(excluded: {r['excluded']['stale']} stale, {r['excluded']['missing']} missing)")
    md.append(f"- native would have injected: **{r['native_tokens_total']:,}** tok")
    md.append(f"- lean-ctx actually injected: **{r['realized_tokens_total']:,}** tok")
    md.append(f"- **saved: {r['tokens_saved_total']:,} tok ({r['savings_pct']}%)**\n")
    md.append(f"  - cached stubs: n={r['stub_reads']['n']}, saved {r['stub_reads']['saved']:,} "
              f"(native {r['stub_reads']['native']:,} → {r['stub_reads']['realized']:,})")
    md.append(f"  - content reads: n={r['content_reads']['n']}, saved {r['content_reads']['saved']:,} "
              f"(native {r['content_reads']['native']:,} → {r['content_reads']['realized']:,})\n")
    md.append("| mode | n | native | realized | saved |")
    md.append("|---|--:|--:|--:|--:|")
    for m, v in r["by_mode"].items():
        md.append(f"| {m} | {v['n']} | {v['native']:,} | {v['realized']:,} | {v['saved']:,} |")
    md.append("")
    s = report["ctx_shell"]
    md.append("## ctx_shell — observational vs native Bash (associational)\n")
    md.append(f"- {s['total_calls']} calls, overall median {s['overall_median_tokens']} tok/call\n")
    md.append("| command bucket | lean n | lean median | native n | native median | Δ median (native−lean) |")
    md.append("|---|--:|--:|--:|--:|--:|")
    for b in s["by_command_bucket_vs_native"][:25]:
        dm = b["delta_median"]
        md.append(f"| {b['bucket']} | {b['lean_n']} | {b['lean_median']} | "
                  f"{b['native_n']} | {b['native_median']} | {dm if dm is not None else '—'} |")
    md.append("")
    o = report["overhead"]; n = report["net_ledger"]; bf = report["backfire"]
    md.append("## Net ledger\n")
    md.append(f"- ctx_read saved: **+{n['read_saved']:,}** tok")
    md.append(f"- instruction-block tax: −{o['instruction_block_total_tok']:,} tok "
              f"(median {o['instruction_block_median_tok']:,}/session)")
    md.append(f"- core-schema tax: −{o['schema_tax_total_tok']:,} tok "
              f"({o['schema_tax_per_session_tok']}/session × {o['lean_ctx_sessions']} sessions)")
    md.append(f"- **net: {n['net_tokens']:,} tok** (ctx_shell excluded — observational)")
    md.append(f"- backfire events (raw/fresh/native-fallback): {bf['total_events']}, errors: {bf['errors']}\n")

    with open(args.out + ".md", "w") as fh:
        fh.write("\n".join(md))
    print("\n".join(md))
    print(f"\n[wrote {args.out}.json and {args.out}.md]")

if __name__ == "__main__":
    main()
