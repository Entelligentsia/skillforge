# Calibration

The reviewer is instructed to report only what *"a senior reviewer would block
the PR over"*. On its own that instruction is unfalsifiable: nothing detects
when a corpus edit makes the reviewer noisier, blinder, or both. Every rule
added to `docs/principles/` widens the surface for false positives, and a gate
that fires on trivia gets bypassed reflexively — at which point it protects
nothing while still costing 60 seconds a commit.

This harness makes the calibration measurable. It is the prerequisite for
growing the corpus, not an optional extra.

## Running it

```bash
node tests/calibrate.js                       # score the fixture set
node tests/calibrate.js --repeat 3            # measure run-to-run stability
node tests/calibrate.js --filter block-       # one subset
node tests/calibrate.js --verbose             # show every finding returned
node tests/calibrate.js --json tests/baseline.json    # save a baseline
node tests/calibrate.js --compare tests/baseline.json # diff against one
```

Exit 0 when both thresholds hold, 1 when either is violated, 2 on a setup
error. Defaults: `--max-fp-rate 0.10`, `--min-detection 0.80`.

The reviewer command is `claude -p` by default; override with
`CLEAN_CODE_REVIEW_CMD` to score a different model, a different prompt, or a
stub.

## What it measures

| Metric | Meaning | Why |
|---|---|---|
| **False-positive rate** | Share of clean fixtures where the reviewer raised a gating finding | The number that matters. False positives are what get a gate bypassed, and a bypassed gate protects nothing |
| **Detection rate** | Share of seeded defects the reviewer caught | Guards against over-correcting: a silent reviewer has a perfect FP rate |
| **Exact-slug agreement** | How often the cited rule slug matched the expected one exactly | Non-gating. Tracks rubric clarity, not correctness |
| **Unexpected findings** | Gating findings outside the fixture's expected area | Sometimes a real catch, sometimes drift. Read them |
| **Stability** (`--repeat n`) | Hits out of n runs per fixture | A fixture that scores 2/4 is telling you the rule is ambiguous |

Gating uses the same rule as the commit gate — `severity` of `blocker` or
`major` **and** `confidence: high` — so an advisory or medium-confidence remark
is never counted as a false positive. The harness and the gate must agree on
what "blocks" means, or the numbers describe nothing.

## The fixture set

14 fixtures across JavaScript, TypeScript, Python, Go, and Java.

**Six clean fixtures, deliberately tempting.** Each one is code that *looks*
flaggable but is explicitly permitted by the corpus: guard-clause flattening,
a second (not third) duplication, short scope-local names, a documented
`ENOENT` ignore, a byte-for-byte code move of flawed pre-existing code, and an
options object with many fields including a boolean. A reviewer that flags these
has learned the wrong lesson from the rubric.

**Eight blocking fixtures, one seeded defect each**: a swallowed exception, a
`validateAndSave` doing three jobs, a `GetSession` that creates and persists,
two positional boolean parameters, a `sleep(2)` in a test, unreachable code
after a return, an error that drops both cause and context, and a test that
asserts only on mock call counts.

Clean fixtures outnumber blocking ones relative to real-world defect density on
purpose. The failure mode this harness exists to catch is noise, not blindness.

## Adding a fixture

```
tests/fixtures/<name>/
├── case.json
└── change.diff
```

```json
{
  "expect": "block",
  "expect_principle": "errors/never-swallow",
  "also_accepts": ["functions/no-hidden-side-effects"],
  "allow_extra": ["functions/single-responsibility"],
  "expect_file": "OrderService.java",
  "language": "java",
  "rationale": "Why a senior reviewer would block this — or why they would not."
}
```

- `expect` is `pass` or `block`; blocking fixtures must declare
  `expect_principle`.
- `expect_file` is optional and matched as a suffix.
- `also_accepts` lists other areas that count as **catching the same defect**.
  Some defects are correctly citable two ways — a query-named function that
  mutates is both `naming/no-disinformation` and
  `functions/no-hidden-side-effects` — and without this the harness scores a
  correct finding as a miss, which pushes you to "fix" a reviewer that was
  right. Matching is by area; exact-slug agreement still records which one it
  chose.
- `allow_extra` lists further areas that are legitimate to find here but are
  **not** the seeded defect, so a correct second catch is not scored as noise.
- `rationale` is for the human reading a failure at 5pm. Write it as the
  argument you would make in review.

**Write the diff as a real unified diff**, including context lines. The reviewer
sees exactly this text, so a fixture with a misleading hunk measures the fixture,
not the reviewer.

When adding a rule to the corpus, add fixtures **in both directions**: one that
the rule should catch, and one nearby case it should leave alone. A rule with
only a positive fixture is a rule with no measured cost.

## Workflow for changing the corpus

1. `node tests/calibrate.js --json tests/baseline.json` — record where you are.
2. Edit `docs/principles/`, or add a rule area.
3. Add fixtures in both directions for the new rule.
4. `node tests/calibrate.js --compare tests/baseline.json`.
5. Read the deltas. A rule that raises detection while raising the
   false-positive rate is usually a bad trade — the corpus is a review rubric,
   not a lint config, and its currency is trust.
6. Refresh the baseline only when you accept the new numbers.

## Interpreting a failure

- **A clean fixture flagged** — either the rule is too broadly worded, or the
  fixture's exemption is not stated explicitly enough in the corpus. Usually the
  fix is a "Not a violation:" clause, not a weaker rule.
- **A seeded defect missed** — the rule may be buried, may lack a decidable
  trigger, or the diff may not carry enough context to judge. Check whether a
  human reviewer could catch it from the diff alone; if not, the fixture is
  wrong.
- **Low stability across repeats** — the rule is ambiguous. Ambiguous rules
  produce arguments in code review, which is exactly what the corpus exists to
  prevent.
- **Unexpected findings that are actually correct** — promote them: add
  `allow_extra`, or seed a dedicated fixture. The reviewer found something the
  fixture author did not.

## The committed baseline

`tests/baseline.json` holds a recorded run against `claude -p` on Claude Code
2.1.220: **0% false positives across 6 clean fixtures, 100% detection across 8
seeded defects, 88% exact-slug agreement, 1 unexpected finding.**

That unexpected finding is worth reading rather than suppressing: on the
`block-lying-name` fixture the reviewer also flagged that treating every
non-nil error as "session not found" swallows real failures — a genuine second
defect the fixture author had not seeded. It is recorded in that fixture's
`allow_extra`.

Use it as the comparison point when editing the corpus:

```bash
node tests/calibrate.js --compare tests/baseline.json
```

## Testing the harness itself

```bash
bash tests/calibrate.test.sh
```

37 assertions run the harness against scripted stub reviewers — perfect,
inverted, noisy, low-confidence, wrong-area, flaky, and malformed — with no
model involved. It verifies scoring, that gating rules match the commit gate,
area-vs-exact-slug matching, threshold enforcement, stability accounting,
baseline comparison, and fixture validation.

A measurement instrument nobody has calibrated is just an opinion with decimal
places, so the harness is verified before its numbers are trusted.

## Limits

- **The numbers are model- and version-specific.** A baseline recorded against
  one model says nothing about another. `--json` stamps the reviewer command,
  CLI version, and timestamp into the file for exactly this reason — but note
  that `claude -p` follows whatever model the user has configured, so the model
  itself is not captured. If you compare baselines across machines, pin the
  model explicitly via `CLEAN_CODE_REVIEW_CMD`.
- **14 fixtures is a smoke test, not a benchmark.** It will catch a corpus edit
  that makes the reviewer obviously noisier. It will not resolve a 5% change in
  false-positive rate — the sample is far too small for that.
- **Fixtures are synthetic.** Real diffs are longer, messier, and carry context
  a fixture cannot. Treat a green run as a floor, not a certificate.
