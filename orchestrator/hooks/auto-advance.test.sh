#!/usr/bin/env bash
# Behaviour test for auto-advance.sh. Run from anywhere:
#   bash orchestrator/hooks/auto-advance.test.sh
# Exits non-zero on any failure. Tail output names which case broke.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-advance.sh"
STORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/telemetry/session-store.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# shellcheck disable=SC1090
source "$STORE"

make_pipeline() {
    local path="$1"
    local status="$2"
    local phase="${3:-plan}"
    mkdir -p "$(dirname "$path")"
    cat > "$path" <<EOF
## Current phase
$phase
## Phase status
$status
## Lifecycle state
active
## Pending user input

EOF
}

# Case 1 — empty stdin → FALLBACK marker on stderr, silent stdout.
LOOM_ROOT="$TMP/case1/.loom"
mkdir -p "$LOOM_ROOT"
out="$(: | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>"$TMP/case1.err")"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case1.err" || fail "case 1: empty stdin should emit LOOM_SESSION_FALLBACK=1"
[ -z "$out" ] || fail "case 1: unidentifiable session must be silent, got: $out"
pass "case 1: empty stdin → FALLBACK marker, silent"

# Case 2 — malformed JSON → FALLBACK marker, silent stdout.
out="$(printf 'not json {{' | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>"$TMP/case2.err")"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case2.err" || fail "case 2: malformed JSON should emit LOOM_SESSION_FALLBACK=1"
[ -z "$out" ] || fail "case 2: malformed JSON must be silent, got: $out"
pass "case 2: malformed JSON → FALLBACK marker, silent"

# Case 3 — payload missing session_id → FALLBACK marker, silent stdout.
out="$(echo '{"cwd":"/tmp"}' | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>"$TMP/case3.err")"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case3.err" || fail "case 3: missing session_id should emit LOOM_SESSION_FALLBACK=1"
[ -z "$out" ] || fail "case 3: missing session_id must be silent, got: $out"
pass "case 3: missing session_id → FALLBACK marker, silent"

# Case 4 — NO-OWNER, no intent marker, sole Pending project: NO claim, NO nudge.
LOOM_ROOT="$TMP/case4/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
out="$(echo "{\"session_id\":\"sess-B\",\"cwd\":\"$TMP/case4\",\"stop_hook_active\":false}" | bash "$HOOK" 2>/dev/null)"
[ ! -f "$LOOM_ROOT/.sessions/sess-B.txt" ] || fail "case 4: unpinned stop must not write a session record"
[ -z "$out" ] || fail "case 4: unpinned stop must be silent, got: $out"
pass "case 4: NO-OWNER stop stays silent and claims nothing"

# Case 5 — PINNED, pinned project not Pending → silent zero-exit.
LOOM_ROOT="$TMP/case5/.loom"
make_pipeline "$LOOM_ROOT/projectX/pipeline.md" "Done" "plan"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
session_store_write "$LOOM_ROOT" "sess-A" "projectX"
out="$(echo "{\"session_id\":\"sess-A\",\"cwd\":\"$TMP/case5\",\"stop_hook_active\":false}" | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] || fail "case 5: pinned-to-X (Done) should be silent, got: $out"
pass "case 5: PINNED + pin not Pending → silent zero-exit"

# Case 6 — PINNED to X, Y is sole Pending → silent suppression.
out="$(echo "{\"session_id\":\"sess-A\",\"cwd\":\"$TMP/case5\",\"stop_hook_active\":false}" | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] || fail "case 6: pin X must suppress Y, got: $out"
pass "case 6: PINNED suppresses other Pending workspaces"

# Case 7 — stop_hook_active=true → recursion guard exits early, silent, no write.
LOOM_ROOT="$TMP/case7/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
out="$(echo "{\"session_id\":\"sess-C\",\"cwd\":\"$TMP/case7\",\"stop_hook_active\":true}" | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] || fail "case 7: recursion guard should exit silent, got: $out"
[ ! -f "$LOOM_ROOT/.sessions/sess-C.txt" ] || fail "case 7: recursion guard must not write a session record"
pass "case 7: stop_hook_active=true → silent early exit"

# Case 8 — PINNED, pin Pending → advance names only the pinned project.
LOOM_ROOT="$TMP/case8/.loom"
make_pipeline "$LOOM_ROOT/projectX/pipeline.md" "Pending" "plan"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
session_store_write "$LOOM_ROOT" "sess-D" "projectX"
out="$(echo "{\"session_id\":\"sess-D\",\"cwd\":\"$TMP/case8\",\"stop_hook_active\":false}" | bash "$HOOK")"
echo "$out" | grep -q '"decision":"block"' || fail "case 8: pinned X (Pending) should emit decision:block, got: $out"
echo "$out" | grep -q 'projectX' || fail "case 8: advance prompt should name projectX"
echo "$out" | grep -q 'projectY' && fail "case 8: projectY must not appear under pinned session"
pass "case 8: PINNED + pin Pending → advance prompt names only pin"

# Case 9 — PINNED to deleted project → stale marker, silent, record preserved.
LOOM_ROOT="$TMP/case9/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
session_store_write "$LOOM_ROOT" "sess-E" "ghostProject"
out="$(echo "{\"session_id\":\"sess-E\",\"cwd\":\"$TMP/case9\",\"stop_hook_active\":false}" | bash "$HOOK" 2>"$TMP/case9.err")"
grep -q 'LOOM_SESSION_STALE=sess-E' "$TMP/case9.err" || fail "case 9: stale pin must emit LOOM_SESSION_STALE=sess-E on stderr"
[ -z "$out" ] || fail "case 9: stale pin must not fall through to another workspace, got: $out"
[ -f "$LOOM_ROOT/.sessions/sess-E.txt" ] || fail "case 9: stale record must not be deleted"
pass "case 9: stale pin → stderr marker, silent, record preserved"

# Case 10 — INTENT ADOPTION: session declared weave intent, orchestrator resolved
# .active to a Pending project → adopt the pin, drop the marker, emit advance.
LOOM_ROOT="$TMP/case10/.loom"
make_pipeline "$LOOM_ROOT/resolved-proj/pipeline.md" "Pending" "build"
mkdir -p "$LOOM_ROOT/.sessions"
: > "$LOOM_ROOT/.sessions/sess-F.weave-intent"
printf 'resolved-proj\n' > "$LOOM_ROOT/.active"
out="$(echo "{\"session_id\":\"sess-F\",\"cwd\":\"$TMP/case10\",\"stop_hook_active\":false}" | bash "$HOOK")"
[ "$(cat "$LOOM_ROOT/.sessions/sess-F.txt" 2>/dev/null)" = "resolved-proj" ] || fail "case 10: intent not converted to pin"
[ ! -f "$LOOM_ROOT/.sessions/sess-F.weave-intent" ] || fail "case 10: intent marker not consumed"
echo "$out" | grep -q '"decision":"block"' || fail "case 10: should emit advance after adoption, got: $out"
echo "$out" | grep -q 'resolved-proj' || fail "case 10: advance must name the adopted project"
pass "case 10: weave-intent + .active → pin adopted and advance emitted"

# Case 11 — intent marker but NO .active yet: silent, no pin, marker preserved.
LOOM_ROOT="$TMP/case11/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
mkdir -p "$LOOM_ROOT/.sessions"
: > "$LOOM_ROOT/.sessions/sess-G.weave-intent"
out="$(echo "{\"session_id\":\"sess-G\",\"cwd\":\"$TMP/case11\",\"stop_hook_active\":false}" | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] || fail "case 11: intent without .active must be silent, got: $out"
[ ! -f "$LOOM_ROOT/.sessions/sess-G.txt" ] || fail "case 11: must not pin without a resolved .active"
[ -f "$LOOM_ROOT/.sessions/sess-G.weave-intent" ] || fail "case 11: intent marker must be preserved for a later firing"
pass "case 11: intent without .active → silent, marker preserved"

# Case 12 — intent marker but .active names a non-existent project: silent, no pin.
LOOM_ROOT="$TMP/case12/.loom"
mkdir -p "$LOOM_ROOT/.sessions"
: > "$LOOM_ROOT/.sessions/sess-H.weave-intent"
printf 'ghost\n' > "$LOOM_ROOT/.active"
out="$(echo "{\"session_id\":\"sess-H\",\"cwd\":\"$TMP/case12\",\"stop_hook_active\":false}" | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] || fail "case 12: .active ghost must be silent, got: $out"
[ ! -f "$LOOM_ROOT/.sessions/sess-H.txt" ] || fail "case 12: must not pin to a non-existent .active project"
pass "case 12: intent + ghost .active → silent, no pin"

# Case 13 — hostile session_id with a path separator: rejected, silent.
LOOM_ROOT="$TMP/case13/.loom"
make_pipeline "$LOOM_ROOT/alpha/pipeline.md" "Pending" "plan"
out="$(echo "{\"session_id\":\"a/b\",\"cwd\":\"$TMP/case13\",\"stop_hook_active\":false}" | bash "$HOOK" 2>"$TMP/case13.err")"; rc=$?
[ "$rc" -eq 0 ] || fail "case 13: hostile sid must exit 0, got rc=$rc"
[ -z "$out" ] || fail "case 13: hostile sid must be silent, got: $out"
grep -q 'LOOM_PIN_REJECTED_SID' "$TMP/case13.err" || fail "case 13: missing sid rejection marker"
pass "case 13: path-separator session_id rejected, silent"

# Case 14 — intent marker + .active names a harness-driven eval run
# (.eval-run present): must NOT adopt it, stay silent, preserve the marker.
LOOM_ROOT="$TMP/case14/.loom"
make_pipeline "$LOOM_ROOT/baseline-123-1/pipeline.md" "Pending" "build"
: > "$LOOM_ROOT/baseline-123-1/.eval-run"
mkdir -p "$LOOM_ROOT/.sessions"
: > "$LOOM_ROOT/.sessions/sess-I.weave-intent"
printf 'baseline-123-1\n' > "$LOOM_ROOT/.active"
out="$(echo "{\"session_id\":\"sess-I\",\"cwd\":\"$TMP/case14\",\"stop_hook_active\":false}" | bash "$HOOK" 2>"$TMP/case14.err")"
[ -z "$out" ] || fail "case 14: must not adopt an eval run, got: $out"
[ ! -f "$LOOM_ROOT/.sessions/sess-I.txt" ] || fail "case 14: must not pin to an eval run"
[ -f "$LOOM_ROOT/.sessions/sess-I.weave-intent" ] || fail "case 14: intent marker must be preserved"
grep -q 'LOOM_SKIP_EVAL_RUN' "$TMP/case14.err" || fail "case 14: missing eval-skip marker"
pass "case 14: weave-intent + eval-run .active → not adopted, silent"

echo
echo "all cases passed"
