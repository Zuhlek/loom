#!/usr/bin/env bash
# Behaviour test for auto-advance.sh. Run from anywhere:
#   bash orchestrator/hooks/auto-advance.test.sh
# Exits non-zero on any failure. Tail output names which case broke.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-advance.sh"
STORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/session-store.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

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

# Case 1 — empty stdin → FALLBACK marker on stderr, no crash.
LOOM_ROOT="$TMP/case1/.loom"
mkdir -p "$LOOM_ROOT"
err="$(: | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>&1 >/dev/null)"
echo "$err" | grep -q 'LOOM_SESSION_FALLBACK=1' \
    || fail "case 1: empty stdin should emit LOOM_SESSION_FALLBACK=1 (got: $err)"
pass "case 1: empty stdin → FALLBACK marker"

# Case 2 — malformed JSON → FALLBACK marker on stderr, no crash.
err="$(printf 'not json {{' | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>&1 >/dev/null)"
echo "$err" | grep -q 'LOOM_SESSION_FALLBACK=1' \
    || fail "case 2: malformed JSON should emit LOOM_SESSION_FALLBACK=1 (got: $err)"
pass "case 2: malformed JSON → FALLBACK marker"

# Case 3 — payload missing session_id → FALLBACK marker.
err="$(echo '{"cwd":"/tmp"}' | LOOM_ROOT="$LOOM_ROOT" bash "$HOOK" 2>&1 >/dev/null)"
echo "$err" | grep -q 'LOOM_SESSION_FALLBACK=1' \
    || fail "case 3: missing session_id should emit LOOM_SESSION_FALLBACK=1"
pass "case 3: missing session_id → FALLBACK marker"

# Case 4 — NO-OWNER, sole Pending project, first-fire writer.
LOOM_ROOT="$TMP/case4/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
out="$(echo "{\"session_id\":\"sess-B\",\"cwd\":\"$TMP/case4\",\"stop_hook_active\":false}" \
    | bash "$HOOK")"
[ -f "$LOOM_ROOT/.sessions/sess-B.txt" ] \
    || fail "case 4: first-fire writer should create .sessions/sess-B.txt"
got="$(cat "$LOOM_ROOT/.sessions/sess-B.txt")"
[ "$got" = "projectY" ] \
    || fail "case 4: store should contain 'projectY', got '$got'"
echo "$out" | grep -q '"decision":"block"' \
    || fail "case 4: expected decision:block JSON on stdout, got: $out"
echo "$out" | grep -q 'projectY' \
    || fail "case 4: advance prompt should name projectY"
pass "case 4: NO-OWNER first-fire writes record and emits advance"

# Case 5 — PINNED, pinned project not Pending → silent zero-exit.
LOOM_ROOT="$TMP/case5/.loom"
make_pipeline "$LOOM_ROOT/projectX/pipeline.md" "Done" "plan"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
# shellcheck disable=SC1090
source "$STORE"
session_store_write "$LOOM_ROOT" "sess-A" "projectX"
out="$(echo "{\"session_id\":\"sess-A\",\"cwd\":\"$TMP/case5\",\"stop_hook_active\":false}" \
    | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] \
    || fail "case 5: pinned-to-X (Done) should be silent, got: $out"
pass "case 5: PINNED + pin not Pending → silent zero-exit"

# Case 6 — PINNED to X, Y is sole Pending → silent suppression (US-003 AC2).
out="$(echo "{\"session_id\":\"sess-A\",\"cwd\":\"$TMP/case5\",\"stop_hook_active\":false}" \
    | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] \
    || fail "case 6: pin X must suppress Y, got: $out"
echo "$out" | grep -q 'projectY' \
    && fail "case 6: projectY must not surface under pinned session"
pass "case 6: PINNED suppresses other Pending workspaces"

# Case 7 — stop_hook_active=true → recursion guard exits early, silent.
LOOM_ROOT="$TMP/case7/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
out="$(echo "{\"session_id\":\"sess-C\",\"cwd\":\"$TMP/case7\",\"stop_hook_active\":true}" \
    | bash "$HOOK" 2>/dev/null)"
[ -z "$out" ] \
    || fail "case 7: recursion guard should exit silent, got: $out"
[ ! -f "$LOOM_ROOT/.sessions/sess-C.txt" ] \
    || fail "case 7: recursion guard must not write a session record"
pass "case 7: stop_hook_active=true → silent early exit"

# Case 8 — PINNED, pin Pending → emits advance naming only the pinned project.
LOOM_ROOT="$TMP/case8/.loom"
make_pipeline "$LOOM_ROOT/projectX/pipeline.md" "Pending" "plan"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
session_store_write "$LOOM_ROOT" "sess-D" "projectX"
out="$(echo "{\"session_id\":\"sess-D\",\"cwd\":\"$TMP/case8\",\"stop_hook_active\":false}" \
    | bash "$HOOK")"
echo "$out" | grep -q '"decision":"block"' \
    || fail "case 8: pinned X (Pending) should emit decision:block, got: $out"
echo "$out" | grep -q 'projectX' \
    || fail "case 8: advance prompt should name projectX"
echo "$out" | grep -q 'projectY' \
    && fail "case 8: projectY must not appear under pinned session"
pass "case 8: PINNED + pin Pending → advance prompt names only pin"

# Case 9 — PINNED to deleted project → stale marker + NO-OWNER fallthrough.
LOOM_ROOT="$TMP/case9/.loom"
make_pipeline "$LOOM_ROOT/projectY/pipeline.md" "Pending" "plan"
session_store_write "$LOOM_ROOT" "sess-E" "ghostProject"
out="$(echo "{\"session_id\":\"sess-E\",\"cwd\":\"$TMP/case9\",\"stop_hook_active\":false}" \
    | bash "$HOOK" 2>"$TMP/case9.err")"
grep -q 'LOOM_SESSION_STALE=sess-E' "$TMP/case9.err" \
    || fail "case 9: stale pin must emit LOOM_SESSION_STALE=sess-E on stderr"
# Stale record is not deleted.
[ -f "$LOOM_ROOT/.sessions/sess-E.txt" ] \
    || fail "case 9: stale record must not be deleted"
pass "case 9: stale pin → stderr marker, record preserved"

echo
echo "all cases passed"
