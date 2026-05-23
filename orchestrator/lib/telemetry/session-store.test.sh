#!/usr/bin/env bash
# Smoke test for session-store.sh. Run from anywhere:
#   bash orchestrator/lib/telemetry/session-store.test.sh
# Exits non-zero on any failure. Tail output names which case broke.

set -uo pipefail

STORE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-store.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# shellcheck disable=SC1090
source "$STORE"

LOOM_ROOT="$TMP/loom"

# Case 1 — session_store_path echoes the canonical path.
expected="$LOOM_ROOT/.sessions/sess-A.txt"
got="$(session_store_path "$LOOM_ROOT" "sess-A")"
[ "$got" = "$expected" ] || fail "case 1: path mismatch (got=$got expected=$expected)"
pass "case 1: session_store_path canonical form"

# Case 2 — write creates parent dir and round-trips a project name.
session_store_write "$LOOM_ROOT" "sess-A" "projectX" || fail "case 2 write returned non-zero"
[ -d "$LOOM_ROOT/.sessions" ] || fail "case 2: parent dir not created"
[ -f "$LOOM_ROOT/.sessions/sess-A.txt" ] || fail "case 2: store file not created"
got="$(session_store_read "$LOOM_ROOT" "sess-A")"
[ "$got" = "projectX" ] || fail "case 2: read returned '$got', expected 'projectX'"
pass "case 2: write + read round-trip"

# Case 3 — read of missing id returns empty string and exits 0.
got="$(session_store_read "$LOOM_ROOT" "sess-missing")" || fail "case 3 read exited non-zero"
[ -z "$got" ] || fail "case 3: expected empty, got '$got'"
pass "case 3: missing record reads empty, exits 0"

# Case 4 — owned_by_other detection.
session_store_write "$LOOM_ROOT" "sess-B" "projectY" || fail "case 4 write sess-B failed"
session_store_owned_by_other "$LOOM_ROOT" "sess-A" "projectY" \
    || fail "case 4a: B should own Y from A's perspective"
if session_store_owned_by_other "$LOOM_ROOT" "sess-B" "projectY"; then
    fail "case 4b: self should be excluded (B owning Y from B's view)"
fi
if session_store_owned_by_other "$LOOM_ROOT" "sess-A" "projectZ"; then
    fail "case 4c: nobody should own Z"
fi
pass "case 4: owned_by_other respects self-exclusion"

# Case 5 — owned_by_other returns non-zero when .sessions/ is missing.
EMPTY_ROOT="$TMP/empty"
if session_store_owned_by_other "$EMPTY_ROOT" "sess-A" "projectX"; then
    fail "case 5: missing .sessions/ should yield non-zero"
fi
pass "case 5: missing .sessions dir yields non-zero"

# Case 6 — last-write-wins on overwrite (atomicity smoke).
session_store_write "$LOOM_ROOT" "sess-A" "projectY" || fail "case 6 overwrite failed"
got="$(session_store_read "$LOOM_ROOT" "sess-A")"
[ "$got" = "projectY" ] || fail "case 6: expected 'projectY', got '$got'"
pass "case 6: overwrite is last-write-wins"

# Case 7 — list_owned emits one session_id<TAB>project line per record.
lines="$(session_store_list_owned "$LOOM_ROOT" | sort)"
expected_lines="$(printf 'sess-A\tprojectY\nsess-B\tprojectY\n' | sort)"
[ "$lines" = "$expected_lines" ] || fail "case 7: list_owned mismatch:
--got--
$lines
--expected--
$expected_lines"
pass "case 7: list_owned emits tab-delimited records"

# Case 8 — sourcing the library twice is idempotent and preserves state.
# shellcheck disable=SC1090
source "$STORE"
# shellcheck disable=SC1090
source "$STORE"
got="$(session_store_read "$LOOM_ROOT" "sess-A")"
[ "$got" = "projectY" ] || fail "case 8: state lost after re-source"
pass "case 8: re-source is idempotent"

echo
echo "all cases passed"
