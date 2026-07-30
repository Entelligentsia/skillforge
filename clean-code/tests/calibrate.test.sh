#!/usr/bin/env bash
# clean-code — self-test for the calibration harness
#
# The harness measures the reviewer. This measures the harness: scoring, gating
# rules, stability accounting, thresholds, and baseline comparison are all
# exercised against scripted stub reviewers, so no model is involved and every
# assertion is exact.
#
# A measurement instrument nobody has calibrated is just an opinion with
# decimal places.
#
# Usage: bash tests/calibrate.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALIBRATE="$HERE/calibrate.js"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/clean-code-calib.XXXXXX")"
trap 'rm -rf "$BASE"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }
assert_eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1" "$2" "$3"; }
assert_contains() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "contains: $2" "$3" ;; esac; }

# ---------------------------------------------------------------- fixture set
FIX="$BASE/fixtures"
mkdir -p "$FIX/aaa-clean" "$FIX/zzz-block"

cat > "$FIX/aaa-clean/case.json" <<'J'
{ "expect": "pass", "language": "javascript", "rationale": "stub clean case" }
J
cat > "$FIX/aaa-clean/change.diff" <<'D'
diff --git a/src/CLEANCASE.js b/src/CLEANCASE.js
--- a/src/CLEANCASE.js
+++ b/src/CLEANCASE.js
@@ -1,1 +1,2 @@
+const total = entries.length;
D

# A second clean fixture, so the false-positive rate can take intermediate
# values — with one clean case it could only ever be 0% or 100%, which makes
# any threshold between them untestable.
mkdir -p "$FIX/bbb-clean"
cat > "$FIX/bbb-clean/case.json" <<'J'
{ "expect": "pass", "language": "javascript", "rationale": "second stub clean case" }
J
cat > "$FIX/bbb-clean/change.diff" <<'D'
diff --git a/src/CLEANCASE2.js b/src/CLEANCASE2.js
--- a/src/CLEANCASE2.js
+++ b/src/CLEANCASE2.js
@@ -1,1 +1,2 @@
+const count = rows.length;
D

cat > "$FIX/zzz-block/case.json" <<'J'
{
  "expect": "block",
  "expect_principle": "errors/never-swallow",
  "expect_file": "BLOCKCASE.js",
  "language": "javascript",
  "rationale": "stub blocking case"
}
J
cat > "$FIX/zzz-block/change.diff" <<'D'
diff --git a/src/BLOCKCASE.js b/src/BLOCKCASE.js
--- a/src/BLOCKCASE.js
+++ b/src/BLOCKCASE.js
@@ -1,1 +1,3 @@
+try { reserve(); } catch (e) {}
D

# ------------------------------------------------------------------ stub maker
# $1 = stub name, $2 = JSON emitted for the clean case, $3 = for the block case
make_stub() {
  cat > "$BASE/$1.sh" <<EOF
#!/bin/sh
prompt=\$(cat)
case "\$prompt" in
  *BLOCKCASE*) printf '%s' '$3' ;;
  *) printf '%s' '$2' ;;
esac
EOF
  chmod +x "$BASE/$1.sh"
  echo "sh $BASE/$1.sh"
}

NONE='{"findings":[]}'
SWALLOW='{"findings":[{"id":"f1","file":"src/BLOCKCASE.js","line":1,"principle":"errors/never-swallow","severity":"blocker","confidence":"high","summary":"empty catch"}]}'
SWALLOW_SIBLING='{"findings":[{"id":"f1","file":"src/BLOCKCASE.js","line":1,"principle":"errors/fail-fast","severity":"blocker","confidence":"high","summary":"empty catch"}]}'
SWALLOW_LOWCONF='{"findings":[{"id":"f1","file":"src/BLOCKCASE.js","line":1,"principle":"errors/never-swallow","severity":"blocker","confidence":"medium","summary":"empty catch"}]}'
WRONG_AREA='{"findings":[{"id":"f1","file":"src/BLOCKCASE.js","line":1,"principle":"naming/intent-revealing","severity":"major","confidence":"high","summary":"bad name"}]}'
NOISE='{"findings":[{"id":"f1","file":"src/CLEANCASE.js","line":1,"principle":"naming/intent-revealing","severity":"major","confidence":"high","summary":"could be clearer"}]}'
ADVISORY='{"findings":[{"id":"f1","file":"src/CLEANCASE.js","line":1,"principle":"naming/intent-revealing","severity":"advisory","confidence":"high","summary":"nit"}]}'
MEDIUM='{"findings":[{"id":"f1","file":"src/CLEANCASE.js","line":1,"principle":"naming/intent-revealing","severity":"major","confidence":"medium","summary":"maybe"}]}'

run() { CLEAN_CODE_REVIEW_CMD="$1" node "$CALIBRATE" --fixtures "$FIX" "${@:2}" 2>&1; }

# ---------------------------------------------------------------------------
echo "scoring"
# ---------------------------------------------------------------------------
CMD=$(make_stub perfect "$NONE" "$SWALLOW")
OUT=$(run "$CMD"); STATUS=$?
assert_eq       "a perfect reviewer passes"        "0"    "$STATUS"
assert_contains "detection is 100%"                "detection rate        100%" "$OUT"
assert_contains "false positives are 0%"           "false-positive rate   0%"   "$OUT"
assert_contains "exact slug agreement is 100%"     "exact-slug agreement  100%" "$OUT"

CMD=$(make_stub inverted "$NOISE" "$NONE")
OUT=$(run "$CMD"); STATUS=$?
assert_eq       "an inverted reviewer fails"       "1"    "$STATUS"
assert_contains "misses are detected"              "detection rate        0%"   "$OUT"
assert_contains "false positives are counted"      "false-positive rate   100%" "$OUT"
assert_contains "the missed fixture is named"      "FAIL zzz-block"             "$OUT"
assert_contains "the noisy fixture is named"       "FAIL aaa-clean"             "$OUT"
assert_contains "the unexpected finding is shown"  "unexpected: src/CLEANCASE.js" "$OUT"

# ---------------------------------------------------------------------------
echo "gating rules mirror the gate"
# ---------------------------------------------------------------------------
CMD=$(make_stub advisory_noise "$ADVISORY" "$SWALLOW")
OUT=$(run "$CMD")
assert_contains "advisory on a clean case is not an FP" "false-positive rate   0%" "$OUT"

CMD=$(make_stub medium_noise "$MEDIUM" "$SWALLOW")
OUT=$(run "$CMD")
assert_contains "medium confidence is not an FP"    "false-positive rate   0%"  "$OUT"

CMD=$(make_stub lowconf "$NONE" "$SWALLOW_LOWCONF")
OUT=$(run "$CMD")
assert_contains "medium-confidence hit does not count" "detection rate        0%" "$OUT"

# ---------------------------------------------------------------------------
echo "area matching vs exact slug"
# ---------------------------------------------------------------------------
CMD=$(make_stub sibling "$NONE" "$SWALLOW_SIBLING")
OUT=$(run "$CMD"); STATUS=$?
assert_eq       "a sibling rule in the same area counts" "0" "$STATUS"
assert_contains "detection still 100%"             "detection rate        100%" "$OUT"
assert_contains "but exact agreement drops"        "exact-slug agreement  0%"   "$OUT"

CMD=$(make_stub wrongarea "$NONE" "$WRONG_AREA")
OUT=$(run "$CMD")
assert_contains "a different area is a miss"       "detection rate        0%"   "$OUT"
assert_contains "and is reported as unexpected"    "unexpected: src/BLOCKCASE.js" "$OUT"

# also_accepts: some defects are correctly citable under two areas, and scoring
# those as misses would push you to "fix" a reviewer that was right.
ALT="$BASE/alt-fixtures"
mkdir -p "$ALT/zzz-block"
cp "$FIX/zzz-block/change.diff" "$ALT/zzz-block/change.diff"
cat > "$ALT/zzz-block/case.json" <<'J'
{
  "expect": "block",
  "expect_principle": "errors/never-swallow",
  "also_accepts": ["naming/intent-revealing"],
  "expect_file": "BLOCKCASE.js",
  "language": "javascript",
  "rationale": "stub cross-area case"
}
J
OUT=$(CLEAN_CODE_REVIEW_CMD="$CMD" node "$CALIBRATE" --fixtures "$ALT" 2>&1); STATUS=$?
assert_eq       "an also_accepts area counts as a hit" "0" "$STATUS"
assert_contains "detection credited"               "detection rate        100%" "$OUT"
assert_contains "exact slug still marked wrong"    "exact-slug agreement  0%"   "$OUT"
assert_contains "and it is not double-counted as noise" "unexpected findings   0" "$OUT"

# ---------------------------------------------------------------------------
echo "thresholds"
# ---------------------------------------------------------------------------
CMD=$(make_stub perfect2 "$NONE" "$SWALLOW")
run "$CMD" --min-detection 1.0 > /dev/null 2>&1
assert_eq "a met detection threshold passes"       "0" "$?"

# Noisy on one clean fixture, quiet on the other: a 50% false-positive rate.
cat > "$BASE/half.sh" <<EOF
#!/bin/sh
prompt=\$(cat)
case "\$prompt" in
  *BLOCKCASE*)   printf '%s' '$SWALLOW' ;;
  *CLEANCASE2*)  printf '%s' '$NONE' ;;
  *)             printf '%s' '$NOISE' ;;
esac
EOF
chmod +x "$BASE/half.sh"

OUT=$(run "sh $BASE/half.sh" --max-fp-rate 0.6); STATUS=$?
assert_contains "half the clean fixtures are noisy" "false-positive rate   50%" "$OUT"
assert_eq "an FP rate under the cap passes"        "0" "$STATUS"
run "sh $BASE/half.sh" --max-fp-rate 0.2 > /dev/null 2>&1
assert_eq "an FP rate over the cap fails"          "1" "$?"

# ---------------------------------------------------------------------------
echo "reviewer failures"
# ---------------------------------------------------------------------------
CMD=$(make_stub garbage "not json" "not json")
OUT=$(run "$CMD"); STATUS=$?
assert_eq       "unparseable output fails the run" "1"     "$STATUS"
assert_contains "and is reported as an error"      "ERR "  "$OUT"
assert_contains "with the reason"                  "no JSON object" "$OUT"

# ---------------------------------------------------------------------------
echo "stability across repeats"
# ---------------------------------------------------------------------------
COUNTER="$BASE/counter"
cat > "$BASE/flaky.sh" <<EOF
#!/bin/sh
prompt=\$(cat)
case "\$prompt" in
  *BLOCKCASE*)
    n=\$(cat "$COUNTER" 2>/dev/null || echo 0)
    echo \$((n + 1)) > "$COUNTER"
    if [ \$((n % 2)) -eq 0 ]; then printf '%s' '$SWALLOW'; else printf '%s' '$NONE'; fi
    ;;
  *) printf '%s' '$NONE' ;;
esac
EOF
chmod +x "$BASE/flaky.sh"
rm -f "$COUNTER"
OUT=$(run "sh $BASE/flaky.sh" --repeat 4)
assert_contains "a flaky reviewer shows partial stability" "(2/4)" "$OUT"
assert_contains "and the fixture is marked failing"        "FAIL zzz-block" "$OUT"

# ---------------------------------------------------------------------------
echo "baseline comparison"
# ---------------------------------------------------------------------------
CMD=$(make_stub good "$NONE" "$SWALLOW")
run "$CMD" --json "$BASE/baseline.json" > /dev/null 2>&1
assert_eq "baseline is written" "0" "$([ -f "$BASE/baseline.json" ] && echo 0 || echo 1)"

CMD=$(make_stub regressed "$NONE" "$NONE")
OUT=$(run "$CMD" --compare "$BASE/baseline.json")
assert_contains "a regression is reported"        "REGRESSED"  "$OUT"
assert_contains "naming the fixture"              "zzz-block"  "$OUT"

CMD=$(make_stub good2 "$NONE" "$SWALLOW")
OUT=$(run "$CMD" --compare "$BASE/baseline.json")
assert_contains "no drift reports no change"      "no change"  "$OUT"

# ---------------------------------------------------------------------------
echo "fixture selection and validation"
# ---------------------------------------------------------------------------
CMD=$(make_stub filt "$NONE" "$SWALLOW")
OUT=$(run "$CMD" --filter zzz)
assert_contains "filter narrows the run"          "1 fixtures" "$OUT"

mkdir -p "$BASE/bad/case-a"
cat > "$BASE/bad/case-a/case.json" <<'J'
{ "expect": "block", "language": "javascript" }
J
touch "$BASE/bad/case-a/change.diff"
OUT=$(CLEAN_CODE_REVIEW_CMD="true" node "$CALIBRATE" --fixtures "$BASE/bad" 2>&1); STATUS=$?
assert_eq       "a fixture missing its principle is rejected" "2" "$STATUS"
assert_contains "with a clear reason" "must declare expect_principle" "$OUT"

# ---------------------------------------------------------------------------
echo "real fixture set integrity"
# ---------------------------------------------------------------------------
CMD=$(make_stub real "$NONE" "$NONE")
OUT=$(CLEAN_CODE_REVIEW_CMD="$CMD" node "$CALIBRATE" 2>&1)
assert_contains "the shipped fixtures load"       "14 fixtures" "$OUT"
assert_contains "prompts assemble for every one"  "detection rate" "$OUT"
case "$OUT" in *"ERR "*) fail "no prompt-assembly errors" "no ERR lines" "$OUT" ;; *) pass "no prompt-assembly errors" ;; esac

# ---------------------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
