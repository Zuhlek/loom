#!/usr/bin/env bash
# Smoke test for locks.sh. Run from anywhere:
#   bash orchestrator/lib/locks.test.sh
# Exits non-zero on any failure. Tail output names which case broke.
#
# Regression target: the original `_acquire` recorded `$$` (the
# ephemeral subshell PID that dies the moment `bash locks.sh ...`
# returns), so `_release` from a fresh subshell saw a different `$$`
# and refused. Fix records `$PPID` (the invoking agent / shell), which
# IS stable across the same caller's acquire and release.

set -uo pipefail

LOCKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/locks.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
export LOOM_ROOT=.loom
mkdir -p .loom/test-proj

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# Case 1 — acquire and release in two separate bash invocations.
# This is the exact path every task-builder used; it's the regression
# the PID-mismatch caused.
bash "$LOCKS" acquire-task test-proj T-001 || fail "case 1 acquire returned non-zero"
[ -d .loom/test-proj/.locks/T-001.lock ] || fail "case 1 lock dir not created"
bash "$LOCKS" release-task test-proj T-001 || fail "case 1 release returned non-zero (PID mismatch regression)"
[ -d .loom/test-proj/.locks/T-001.lock ] && fail "case 1 lock dir still present after release"
pass "case 1: acquire+release across subshells"

# Case 2 — double-acquire from the same holder fails (mkdir contention
# is the atomicity primitive).
bash "$LOCKS" acquire-task test-proj T-002 || fail "case 2 first acquire returned non-zero"
if bash "$LOCKS" acquire-task test-proj T-002 2>/dev/null; then
    fail "case 2 second acquire should have failed"
fi
bash "$LOCKS" release-task test-proj T-002 || fail "case 2 release returned non-zero"
pass "case 2: double-acquire refused"

# Case 3 — stale lock with dead recorded PID is auto-cleared on acquire.
mkdir -p .loom/test-proj/.locks/T-003.lock
jq -cn --argjson pid 999999 \
       --arg host "$(hostname)" \
       --arg started "2026-01-01T00:00:00Z" \
       --arg label "T-003" \
       '{pid:$pid,host:$host,"started-at":$started,label:$label}' \
    > .loom/test-proj/.locks/T-003.lock/info.json
bash "$LOCKS" acquire-task test-proj T-003 || fail "case 3 stale acquire returned non-zero"
bash "$LOCKS" release-task test-proj T-003 || fail "case 3 release returned non-zero"
pass "case 3: stale lock (dead PID) recovered on acquire"

# Case 4 — release refused when a different LIVE holder owns the lock.
# Use PID 1 (init) as a distinct, guaranteed-alive holder different
# from the test script's PPID. `$$` would resolve in the caller shell
# before the subshell starts, defeating the test.
bash "$LOCKS" acquire-task test-proj T-004 || fail "case 4 acquire returned non-zero"
if LOOM_HOLDER_PID=1 bash "$LOCKS" release-task test-proj T-004 2>/dev/null; then
    fail "case 4 release with different live holder should have failed"
fi
bash "$LOCKS" release-task test-proj T-004 || fail "case 4 real-holder release returned non-zero"
pass "case 4: cross-holder release refused; real holder succeeds"

# Case 5 — release of a stale lock by anyone on the same host succeeds
# (cleanup semantics). The original-strict PID check would have refused.
mkdir -p .loom/test-proj/.locks/T-005.lock
jq -cn --argjson pid 999999 \
       --arg host "$(hostname)" \
       --arg started "2026-01-01T00:00:00Z" \
       --arg label "T-005" \
       '{pid:$pid,host:$host,"started-at":$started,label:$label}' \
    > .loom/test-proj/.locks/T-005.lock/info.json
bash "$LOCKS" release-task test-proj T-005 || fail "case 5 stale-release returned non-zero"
[ -d .loom/test-proj/.locks/T-005.lock ] && fail "case 5 stale lock should have been cleared"
pass "case 5: stale lock released by anyone on same host"

# Case 6 — project lock parity (same fix applies; same surface).
bash "$LOCKS" acquire test-proj plan || fail "case 6 acquire returned non-zero"
[ -d .loom/test-proj/.lock ] || fail "case 6 project lock dir not created"
bash "$LOCKS" release test-proj || fail "case 6 release returned non-zero"
[ -d .loom/test-proj/.lock ] && fail "case 6 project lock still present after release"
pass "case 6: project lock acquire+release across subshells"

echo
echo "all cases passed"
