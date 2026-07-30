#!/usr/bin/env sh
# clean-code — git-native pre-commit gate
#
# Installed by /clean-code:setup with this file's absolute path baked into the
# repo's hook, because ${CLAUDE_PLUGIN_ROOT} does not exist in git's environment.
#
# Contains no judgment about code quality: every decision is delegated to
# gate.js, which is the same code path the in-session gate uses.
#
# Exit 0 = commit proceeds. Exit 1 = commit blocked pending review.

set -u

PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GATE="$PLUGIN_ROOT/hooks/gate.js"

# A dangling hook (plugin uninstalled or moved) degrades to a notice, never a
# blocked commit — regardless of fail_mode.
if [ ! -f "$GATE" ]; then
  echo "clean-code: plugin files missing — gate skipped (run /clean-code:remove in this repo to clean up)" >&2
  exit 0
fi

if ! command -v node > /dev/null 2>&1; then
  echo "clean-code: node not found — gate skipped" >&2
  exit 0
fi

# Structural decision: opt-in, pause, bypass, merge in progress, empty tree,
# already-reviewed. Exit 0 here means there is nothing to review.
node "$GATE" gate-check
case $? in
  0) exit 0 ;;
  1) ;; # review needed — continue below
  *)
    echo "clean-code: gate error — allowing commit" >&2
    exit 0
    ;;
esac

FAIL_MODE=$(node "$GATE" config 2>/dev/null | sed -n 's/.*"fail_mode": *"\([a-z]*\)".*/\1/p' | head -1)
[ -z "$FAIL_MODE" ] && FAIL_MODE=open
TIMEOUT=$(node "$GATE" config 2>/dev/null | sed -n 's/.*"headless_timeout_s": *\([0-9]*\).*/\1/p' | head -1)
[ -z "$TIMEOUT" ] && TIMEOUT=180

# A review tool that can brick commits gets uninstalled. Default is fail-open
# with a loud warning; teams that want the opposite set fail_mode: closed.
degrade() {
  if [ "$FAIL_MODE" = "closed" ]; then
    echo "clean-code: $1 — commit BLOCKED (fail_mode: closed)" >&2
    echo "            override for this commit:  SKIP_CLEAN_REVIEW=1 git commit ..." >&2
    exit 1
  fi
  echo "clean-code: $1 — commit allowed without review (fail_mode: open)" >&2
  exit 0
}

command -v claude > /dev/null 2>&1 || degrade "claude CLI not found"

echo "clean-code: reviewing staged changes..." >&2

PROMPT=$(node "$GATE" prompt 2>/dev/null) || degrade "could not assemble review prompt"

if command -v timeout > /dev/null 2>&1; then
  REVIEW=$(printf '%s' "$PROMPT" | timeout "$TIMEOUT" claude -p 2>/dev/null)
  STATUS=$?
  [ "$STATUS" -eq 124 ] && degrade "review timed out after ${TIMEOUT}s"
else
  REVIEW=$(printf '%s' "$PROMPT" | claude -p 2>/dev/null)
  STATUS=$?
fi

[ "$STATUS" -ne 0 ] && degrade "review command failed (exit $STATUS)"
[ -z "$REVIEW" ] && degrade "review returned no output"

# triage applies the configured severity threshold, writes the marker on a pass,
# or writes pending.json and prints the findings on a block.
printf '%s' "$REVIEW" | node "$GATE" triage
case $? in
  0) exit 0 ;;
  1) exit 1 ;;
  *) degrade "could not parse review output" ;;
esac
