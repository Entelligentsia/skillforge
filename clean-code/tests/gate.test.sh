#!/usr/bin/env bash
# clean-code — gate.js test suite
#
# Exercises the deterministic core: commit detection, review identity stability,
# marker lifecycle, opt-in/pause, bypass, config resolution and locking, pending
# state, and diff excludes. No model involved — every assertion here is exact.
#
# SAFETY: every helper that writes to a repository calls guard(), which aborts
# unless the current directory is inside this run's scratch base. Test fixtures
# must never be able to touch a real working repository.
#
# Usage: bash tests/gate.test.sh

set -uo pipefail

GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/gate.js"
TEST_BASE="$(mktemp -d "${TMPDIR:-/tmp}/clean-code-tests.XXXXXX")"
trap 'cd /; rm -rf "$TEST_BASE"' EXIT

PASS=0
FAIL=0
REPO_N=0
REPO=""

pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }

assert_eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1" "$2" "$3"; }
assert_ne() { [ "$2" != "$3" ] && pass "$1" || fail "$1" "different from $2" "$3"; }
assert_contains() {
  case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "contains: $2" "$3" ;; esac
}
assert_missing() {
  case "$3" in *"$2"*) fail "$1" "must not contain: $2" "present" ;; *) pass "$1" ;; esac
}

# Refuse to mutate anything outside the scratch base. Called by every helper
# that creates repos, writes config, or commits.
guard() {
  case "$PWD/" in
    "$TEST_BASE"/*) ;;
    *)
      printf '\nABORT: test helper called outside scratch base\n  cwd:  %s\n  base: %s\n' "$PWD" "$TEST_BASE" >&2
      exit 99
      ;;
  esac
}

# Sets $REPO and cds into it. Must be called directly — never as $(new_repo),
# which would run the cd in a subshell and leave the caller in the source tree.
new_repo() {
  REPO_N=$((REPO_N + 1))
  REPO="$TEST_BASE/repo-$REPO_N"
  mkdir -p "$REPO"
  cd "$REPO" || exit 1
  guard
  git init -q -b main .
  git config user.email test@example.com
  git config user.name "Test"
  git config commit.gpgsign false
}

opt_in() {
  guard
  mkdir -p .claude
  printf -- '---\nenabled: true\n---\n' > .claude/clean-code.local.md
}

commit_all() {
  guard
  git add -A
  SKIP_CLEAN_REVIEW=1 git commit -q -m "${1:-wip}"
}

json_str() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

# Run the PreToolUse entry point with a Bash command, echo allow|deny.
check() {
  local out
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(json_str "$1")" | node "$GATE" check 2>/dev/null)
  case "$out" in *'"deny"'*) echo "deny" ;; *) echo "allow" ;; esac
}

# ---------------------------------------------------------------------------
echo "commit detection"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo hello > a.txt
git add a.txt

assert_eq "plain commit is gated"             deny  "$(check 'git commit -m "add a"')"
assert_eq "commit -am is gated"               deny  "$(check 'git commit -am wip')"
assert_eq "git -C path commit is gated"       deny  "$(check "git -C $REPO commit -m x")"
assert_eq "git -c k=v commit is gated"        deny  "$(check 'git -c core.editor=true commit')"
assert_eq "chained && commit is gated"        deny  "$(check 'npm test && git commit -m x')"
assert_eq "commit named inside a quoted arg"  allow "$(check 'git log --grep "git commit fix"')"
assert_eq "git status is not a commit"        allow "$(check 'git status')"
assert_eq "git commit-tree is not a commit"   allow "$(check 'git commit-tree abc123')"
assert_eq "unrelated command allowed"         allow "$(check 'ls -la')"
assert_eq "echo mentioning git commit"        allow "$(check 'echo "run git commit later"')"

# ---------------------------------------------------------------------------
echo "opt-in, pause, and marker lifecycle"
# ---------------------------------------------------------------------------
rm -rf .claude
assert_eq "repo without config is dormant"    allow "$(check 'git commit -m x')"

opt_in
assert_eq "opted-in repo gates"               deny  "$(check 'git commit -m x')"

printf -- '---\nenabled: false\n---\n' > .claude/clean-code.local.md
assert_eq "enabled:false pauses the gate"     allow "$(check 'git commit -m x')"

opt_in
node "$GATE" mark passed > /dev/null
assert_eq "marked tree passes"                allow "$(check 'git commit -m x')"

echo "more" >> a.txt && git add a.txt
assert_eq "changing staged content re-gates"  deny  "$(check 'git commit -m x')"

node "$GATE" mark fixes-applied > /dev/null
assert_eq "fixes-applied marker passes"       allow "$(check 'git commit -m x')"

# ---------------------------------------------------------------------------
echo "review identity"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo one > a.txt && git add a.txt

ID1=$(node "$GATE" hash)
assert_eq "review id is stable across calls"  "$ID1" "$(node "$GATE" hash)"

echo two >> a.txt && git add a.txt
ID2=$(node "$GATE" hash)
assert_ne "content change yields new id"      "$ID1" "$ID2"

git rm -q --cached a.txt > /dev/null && git add a.txt
assert_eq "restaging same content is stable"  "$ID2" "$(node "$GATE" hash)"

commit_all "base"
echo three > b.txt && git add b.txt
ID3=$(node "$GATE" hash)
commit_all "advance"
git rm -q --cached b.txt > /dev/null 2>&1 || true
assert_ne "new base commit yields new id"     "$ID3" "$(node "$GATE" hash)"

# ---------------------------------------------------------------------------
echo "structural allowances"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo one > a.txt
commit_all "first"

assert_eq "empty staged tree passes"          allow "$(check 'git commit --amend -m reword')"

echo two > b.txt && git add b.txt
assert_eq "new staged content gates"          deny  "$(check 'git commit -m second')"

GITDIR="$(git rev-parse --absolute-git-dir)"
touch "$GITDIR/MERGE_HEAD"
assert_eq "merge in progress passes"          allow "$(check 'git commit -m merge')"
rm "$GITDIR/MERGE_HEAD"

touch "$GITDIR/CHERRY_PICK_HEAD"
assert_eq "cherry-pick in progress passes"    allow "$(check 'git commit -m pick')"
rm "$GITDIR/CHERRY_PICK_HEAD"

mkdir -p "$GITDIR/rebase-merge"
assert_eq "rebase in progress passes"         allow "$(check 'git commit -m rebase')"
rmdir "$GITDIR/rebase-merge"

assert_eq "gate restored after operation"     deny  "$(check 'git commit -m second')"

# ---------------------------------------------------------------------------
echo "bypass"
# ---------------------------------------------------------------------------
assert_eq "inline env bypass passes"          allow "$(check 'SKIP_CLEAN_REVIEW=1 git commit -m hotfix')"
BYPASS_LOG="$GITDIR/clean-review/bypass.log"
assert_eq "bypass is logged"                  "1" "$(wc -l < "$BYPASS_LOG" | tr -d ' ')"

node "$GATE" mark user-approved '{"reason":"hotfix INC-1"}' > /dev/null
assert_eq "user-approved marker passes"       allow "$(check 'git commit -m second')"
assert_eq "user-approved is logged"           "2" "$(wc -l < "$BYPASS_LOG" | tr -d ' ')"
assert_contains "bypass reason recorded"      "INC-1" "$(cat "$BYPASS_LOG")"

# ---------------------------------------------------------------------------
echo "initial commit (no HEAD)"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo first > a.txt && git add a.txt
assert_contains "review id uses empty base"   "empty-" "$(node "$GATE" hash)"
assert_eq "initial commit is gated"           deny  "$(check 'git commit -m initial')"

# ---------------------------------------------------------------------------
echo "config resolution and policy locks"
# ---------------------------------------------------------------------------
new_repo
mkdir -p .claude
cat > .claude/clean-code.policy.md <<'EOF'
---
severity_threshold: major
fail_mode: closed
bypass: reason-required
max_diff_lines: 1000
locked: [fail_mode, bypass]
exclude:
  - "dist/**"
---
Domain layer must not import adapters.
EOF
cat > .claude/clean-code.local.md <<'EOF'
---
fail_mode: open
severity_threshold: blocker
max_diff_lines: 4000
---
Personal note.
EOF

CONFIG=$(node "$GATE" config)
assert_contains "locked key keeps policy value"    '"fail_mode": "closed"'           "$CONFIG"
assert_contains "locked override raises a notice"  "locked by repo policy"           "$CONFIG"
assert_contains "personal may tighten severity"    '"severity_threshold": "blocker"' "$CONFIG"
assert_contains "personal may not raise cap"       '"max_diff_lines": 1000'          "$CONFIG"
assert_contains "policy rubric captured"           "must not import adapters"        "$CONFIG"
assert_contains "personal rubric captured"         "Personal note"                   "$CONFIG"
assert_contains "policy alone opts the repo in"    '"optedIn": true'                 "$CONFIG"

cat > .claude/clean-code.local.md <<'EOF'
---
exclude:
  - "src/**"
---
EOF
assert_contains "personal excludes refused"        "not permitted by repo policy"    "$(node "$GATE" config)"

# ---------------------------------------------------------------------------
echo "pending findings"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo one > a.txt && git add a.txt
echo '[{"id":"f1","file":"a.txt","line":1,"summary":"too clever"}]' | node "$GATE" pending write > /dev/null
PENDING=$(node "$GATE" pending read)
assert_contains "pending is present"          '"present":true'  "$PENDING"
assert_contains "pending is fresh"            '"stale":false'   "$PENDING"

echo two >> a.txt && git add a.txt
assert_contains "pending goes stale on edit"  '"stale":true'    "$(node "$GATE" pending read)"

node "$GATE" pending clear
assert_contains "pending clears"              '"present":false' "$(node "$GATE" pending read)"

# ---------------------------------------------------------------------------
echo "diff excludes and status"
# ---------------------------------------------------------------------------
new_repo
opt_in
mkdir -p dist src
echo "real code" > src/app.js
echo "bundled" > dist/bundle.js
echo "locked" > yarn.lock
git add -A

DIFF=$(node "$GATE" diff)
assert_contains "source file included"        "src/app.js"     "$DIFF"
assert_missing  "dist excluded"               "dist/bundle.js" "$DIFF"
assert_missing  "lockfile excluded"           "yarn.lock"      "$DIFF"

STATUS=$(node "$GATE" status)
assert_contains "status reports active"       '"state": "active"' "$STATUS"
assert_contains "status counts staged files"  '"staged_files": 4' "$STATUS"
assert_contains "status reports unreviewed"   '"reviewed": false' "$STATUS"

# ---------------------------------------------------------------------------
echo "failure modes"
# ---------------------------------------------------------------------------
mkdir -p "$TEST_BASE/not-a-repo" && cd "$TEST_BASE/not-a-repo" || exit 1
assert_eq "outside a git repo, fail open"     allow "$(check 'git commit -m x')"

new_repo
opt_in
echo x > a.txt && git add a.txt
node "$GATE" gate-check > /dev/null 2>&1
assert_eq "gate-check signals review needed"  "1" "$?"
node "$GATE" mark passed > /dev/null
node "$GATE" gate-check > /dev/null 2>&1
assert_eq "gate-check passes once reviewed"   "0" "$?"
node "$GATE" mark nonsense > /dev/null 2>&1
assert_eq "unknown verdict is rejected"       "2" "$?"

# ---------------------------------------------------------------------------
echo "triage — applying the severity threshold"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo x > a.txt && git add a.txt

BLOCKER='{"findings":[{"id":"f1","file":"a.txt","line":1,"severity":"blocker","confidence":"high","summary":"does two things","fix":{"type":"edit","description":"split it"}}]}'
MAJOR_MED='{"findings":[{"id":"f1","file":"a.txt","line":1,"severity":"major","confidence":"medium","summary":"maybe duplicated"}]}'
ADVISORY='{"findings":[{"id":"f1","file":"a.txt","line":1,"severity":"advisory","confidence":"high","summary":"nit"}]}'

echo '{"findings":[]}' | node "$GATE" triage > /dev/null 2>&1
assert_eq "empty findings satisfy the gate"    "0" "$?"
assert_eq "clean review marks the tree"        allow "$(check 'git commit -m x')"

new_repo && opt_in && echo x > a.txt && git add a.txt
echo "$BLOCKER" | node "$GATE" triage > /dev/null 2>&1
assert_eq "high-confidence blocker blocks"     "1" "$?"
assert_eq "blocked tree still gates"           deny "$(check 'git commit -m x')"
assert_contains "blocking writes pending"      '"present":true' "$(node "$GATE" pending read)"

new_repo && opt_in && echo x > a.txt && git add a.txt
echo "$MAJOR_MED" | node "$GATE" triage > /dev/null 2>&1
assert_eq "medium confidence does not block"   "0" "$?"

new_repo && opt_in && echo x > a.txt && git add a.txt
echo "$ADVISORY" | node "$GATE" triage > /dev/null 2>&1
assert_eq "advisory does not block"            "0" "$?"

new_repo && opt_in && echo x > a.txt && git add a.txt
printf -- '---\nenabled: true\nseverity_threshold: blocker\n---\n' > .claude/clean-code.local.md
echo '{"findings":[{"id":"f1","file":"a.txt","line":1,"severity":"major","confidence":"high","summary":"m"}]}' \
  | node "$GATE" triage > /dev/null 2>&1
assert_eq "threshold blocker ignores major"    "0" "$?"

new_repo && opt_in && echo x > a.txt && git add a.txt
printf 'Here you go:\n```json\n%s\n```\n' "$BLOCKER" | node "$GATE" triage > /dev/null 2>&1
assert_eq "fenced reviewer output is parsed"   "1" "$?"

new_repo && opt_in && echo x > a.txt && git add a.txt
echo 'not json at all' | node "$GATE" triage > /dev/null 2>&1
assert_eq "unparseable output signals error"   "2" "$?"

# ---------------------------------------------------------------------------
echo "prompt assembly"
# ---------------------------------------------------------------------------
new_repo
mkdir -p .claude
printf -- '---\nenabled: true\n---\nDomain layer must not import adapters.\n' > .claude/clean-code.local.md
mkdir -p src dist
echo "const x = 1" > src/app.js
echo "bundled" > dist/bundle.js
git add -A

PROMPT=$(node "$GATE" prompt)
assert_contains "prompt carries the contract"   "Return only the JSON object"  "$PROMPT"
assert_contains "prompt carries calibration"    "senior reviewer would block"  "$PROMPT"
assert_contains "prompt carries base rubric"    "naming/intent-revealing"      "$PROMPT"
assert_contains "prompt carries personal rubric" "must not import adapters"    "$PROMPT"
assert_contains "prompt carries the diff"       "src/app.js"                   "$PROMPT"
assert_missing  "prompt respects excludes"      "dist/bundle.js"               "$PROMPT"

# ---------------------------------------------------------------------------
echo "git-native hook (fake claude CLI)"
# ---------------------------------------------------------------------------
HOOK="$(dirname "$GATE")/../scripts/pre-commit.sh"
FAKE_BIN="$TEST_BASE/bin"
mkdir -p "$FAKE_BIN"

fake_claude() {
  printf '#!/bin/sh\ncat > /dev/null\ncat <<%s\n%s\n%s\n' "EOF" "$1" "EOF" > "$FAKE_BIN/claude"
  chmod +x "$FAKE_BIN/claude"
}

new_repo && opt_in && echo x > a.txt && git add a.txt
fake_claude '{"findings":[]}'
PATH="$FAKE_BIN:$PATH" sh "$HOOK" > /dev/null 2>&1
assert_eq "hook passes on a clean review"       "0" "$?"
assert_eq "hook marked the tree"                allow "$(check 'git commit -m x')"

new_repo && opt_in && echo x > a.txt && git add a.txt
fake_claude "$BLOCKER"
PATH="$FAKE_BIN:$PATH" sh "$HOOK" > /dev/null 2>&1
assert_eq "hook blocks on a blocker finding"    "1" "$?"
assert_contains "hook saved pending findings"   '"present":true' "$(node "$GATE" pending read)"

new_repo && opt_in && echo x > a.txt && git add a.txt
node "$GATE" mark passed > /dev/null
PATH="$FAKE_BIN:$PATH" sh "$HOOK" > /dev/null 2>&1
assert_eq "reviewed tree skips the CLI"         "0" "$?"

new_repo && opt_in && echo x > a.txt && git add a.txt
rm -f "$FAKE_BIN/claude"
env PATH="$FAKE_BIN:/usr/bin:/bin" sh "$HOOK" > /dev/null 2>&1
assert_eq "missing CLI fails open by default"   "0" "$?"

new_repo && echo x > a.txt && git add a.txt
mkdir -p .claude
printf -- '---\nenabled: true\nfail_mode: closed\n---\n' > .claude/clean-code.local.md
env PATH="$FAKE_BIN:/usr/bin:/bin" sh "$HOOK" > /dev/null 2>&1
assert_eq "fail_mode closed blocks instead"     "1" "$?"

new_repo && echo x > a.txt && git add a.txt
assert_eq "dormant repo skips the hook"         "0" "$(sh "$HOOK" > /dev/null 2>&1; echo $?)"

# A dangling hook (plugin removed) must degrade to a notice, never block.
cp "$HOOK" "$TEST_BASE/orphan-pre-commit.sh"
mkdir -p "$TEST_BASE/orphan-root/scripts"
cp "$HOOK" "$TEST_BASE/orphan-root/scripts/pre-commit.sh"
new_repo && opt_in && echo x > a.txt && git add a.txt
sh "$TEST_BASE/orphan-root/scripts/pre-commit.sh" > /dev/null 2>&1
assert_eq "missing plugin files degrade to 0"   "0" "$?"

# ---------------------------------------------------------------------------
echo "git worktrees (issue #8)"
# ---------------------------------------------------------------------------
new_repo
opt_in
echo base > a.txt
commit_all "base"
MAIN_REPO="$REPO"
MAIN_GITDIR="$(git rev-parse --absolute-git-dir)"
git worktree add -q "$TEST_BASE/wt-linked" -b linked

cd "$TEST_BASE/wt-linked" || exit 1
guard
STATUS=$(node "$GATE" status)
assert_contains "linked worktree is detected"     '"linked_worktree": true'          "$STATUS"
assert_contains "hooks_dir is the common dir"     "\"hooks_dir\": \"$MAIN_GITDIR/hooks\"" "$STATUS"
assert_missing  "hooks_dir is not the worktree dir" "worktrees/wt-linked/hooks"      "$STATUS"
assert_contains "state_dir stays per-worktree"    "worktrees/wt-linked/clean-review" "$STATUS"

# Bug 2: a hook installed where git actually runs it must be visible to status.
cat > "$MAIN_GITDIR/hooks/pre-commit" <<'EOF'
#!/usr/bin/env sh
# >>> clean-code gate >>>
exit 0
# <<< clean-code gate <<<
EOF
chmod +x "$MAIN_GITDIR/hooks/pre-commit"
opt_in
STATUS=$(node "$GATE" status)
assert_contains "installed hook is seen from worktree" '"managed": true'  "$STATUS"

cd "$MAIN_REPO" || exit 1
assert_contains "installed hook is seen from main"     '"managed": true'  "$(node "$GATE" status)"
assert_contains "main worktree not flagged linked"     '"linked_worktree": false' "$(node "$GATE" status)"
rm "$MAIN_GITDIR/hooks/pre-commit"

# Review state must NOT be shared: identical staged content in two worktrees on
# the same base commit yields the same review id, so a shared state dir would
# let one worktree's approval satisfy the other's gate.
echo same > shared.txt && git add shared.txt
MAIN_ID=$(node "$GATE" hash)
node "$GATE" mark passed > /dev/null
assert_eq "main worktree passes after marking"    allow "$(check 'git commit -m x')"

cd "$TEST_BASE/wt-linked" || exit 1
echo same > shared.txt && git add shared.txt
assert_eq "same content yields same review id"    "$MAIN_ID" "$(node "$GATE" hash)"
assert_eq "approval does not cross worktrees"     deny  "$(check 'git commit -m x')"

# Sentinel-based activation is per-worktree even though the hook is shared.
rm -rf .claude
assert_contains "worktree without sentinel is dormant" '"state": "dormant"' "$(node "$GATE" status)"

# ---------------------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
