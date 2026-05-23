#!/usr/bin/env bash
# setup — verify prerequisites for the eval harness.
#
# The eval harness no longer relies on a SubagentStop hook to capture usage
# data. All cost/usage figures are produced post-hoc by reading Claude Code's
# session transcripts on disk via `orchestrator/lib/telemetry/transcript-harvest.py`.
# This script just verifies the CLI prerequisites and that the test suite
# is green. Idempotent — safe to re-run.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ok()    { printf "  \033[32m✓\033[0m %s\n" "$*"; }
fail()  { printf "  \033[31m✗\033[0m %s\n" "$*"; FAILS=$((FAILS+1)); }

FAILS=0

echo "loom-eval-harness — setup check"
echo

echo "[1/4] CLI prerequisites"
if command -v claude >/dev/null 2>&1; then
    ok "claude CLI on PATH ($(command -v claude))"
else
    fail "claude CLI not found on PATH"
fi
if command -v python3 >/dev/null 2>&1; then
    ok "python3 on PATH ($(python3 --version 2>&1))"
else
    fail "python3 not found"
fi
echo

echo "[2/4] Claude Code project transcripts directory"
PROJECTS_DIR="$HOME/.claude/projects"
if [ -d "$PROJECTS_DIR" ]; then
    ok "$PROJECTS_DIR exists (harvester reads from here)"
else
    fail "$PROJECTS_DIR missing — Claude Code hasn't run yet; run a session first"
fi
echo

echo "[3/4] analytics/ directory"
ANALYTICS_DIR="$SCRIPT_DIR/analytics"
if [ -d "$ANALYTICS_DIR" ]; then
    ok "$ANALYTICS_DIR exists"
else
    mkdir -p "$ANALYTICS_DIR"
    ok "created $ANALYTICS_DIR"
fi
echo

echo "[4/4] Unit tests"
cd "$REPO_ROOT"
lib_t=$(python3 -m unittest discover -s orchestrator/lib        -p 'test_*.py' 2>&1 | tail -1)
ev_t=$( python3 -m unittest discover -s orchestrator/evaluation -p 'test_*.py' 2>&1 | tail -1)
[ "$lib_t" = "OK" ] && ok "orchestrator/lib ($lib_t)"        || fail "orchestrator/lib ($lib_t)"
[ "$ev_t"  = "OK" ] && ok "orchestrator/evaluation ($ev_t)"  || fail "orchestrator/evaluation ($ev_t)"
echo

if [ "$FAILS" -eq 0 ]; then
    printf "\033[32mall green — ready to run baselines\033[0m\n"
    echo
    echo "Next:"
    echo "  pnpm run eval:run        # one /weave iteration (~40min)"
    echo "  pnpm run eval:pool       # five iterations"
    echo "  # then mv .loom/<project>/ orchestrator/evaluation/analytics/<version>/"
    echo "  pnpm run eval:analyse    # harvest pending + render analysis.html"
    exit 0
else
    printf "\033[31m%d check(s) failed — fix the items marked ✗ above\033[0m\n" "$FAILS"
    exit 1
fi
