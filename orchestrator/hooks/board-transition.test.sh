#!/usr/bin/env bash
# Behaviour test for board-transition.py. Run from anywhere:
#   bash orchestrator/hooks/board-transition.test.sh
# Exits non-zero on the first failing case. Prints `ok: <case>` per pass.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/board-transition.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
mk_workspace() {
    # $1 = workspace dir, $2 = project name, $3 = board.md content
    local ws="$1" proj="$2" board="$3"
    mkdir -p "$ws/.loom/$proj/tasks"
    printf '%s' "$proj" > "$ws/.loom/.active"
    printf '%s' "$board" > "$ws/.loom/$proj/board.md"
}

run_hook() {
    # $1 = cwd, $2 = tool_name, $3 = file_path
    local cwd="$1" tool="$2" fp="$3"
    python3 -c "import json,sys; sys.stdout.write(json.dumps({'tool_name': sys.argv[1], 'tool_input': {'file_path': sys.argv[2]}, 'cwd': sys.argv[3]}))" \
        "$tool" "$fp" "$cwd" | python3 "$HOOK"
}

mtime() { python3 -c "import os,sys; print(os.stat(sys.argv[1]).st_mtime_ns)" "$1"; }

# diff_board <board_path> <expected_string> <case_label>
# Writes the expected string to a tmp file (preserves trailing newline) and
# diffs against the board. Exits the script on mismatch.
diff_board() {
    local board="$1" expected="$2" label="$3"
    local exp_file="$TMP/.expected.$$"
    printf '%s' "$expected" > "$exp_file"
    if ! diff -u "$exp_file" "$board" >/dev/null; then
        echo "FAIL: $label: board content mismatch" >&2
        diff -u "$exp_file" "$board" >&2 || true
        exit 1
    fi
    rm -f "$exp_file"
}

BOARD_BASE='# Board — demo

## Backlog
- T-001 first card — touches: a
- T-002 second card — touches: b

## In Progress
- (none)

## Review
- (none)

## Done
- (none)
'

# --------------------------------------------------------------------------- #
# Case 1 — test-log triggers Backlog → In Progress
# --------------------------------------------------------------------------- #
WS="$TMP/case1"
mk_workspace "$WS" "demo" "$BOARD_BASE"
echo "RED: failing assertion" > "$WS/.loom/demo/tasks/T-001.test-log.txt"
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.test-log.txt"

expected='# Board — demo

## Backlog
- T-002 second card — touches: b

## In Progress
- T-001 first card — touches: a

## Review
- (none)

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 1"
pass "case 1: test-log → Backlog → In Progress"

# --------------------------------------------------------------------------- #
# Case 2 — done.md status: green → In Progress → Review
# --------------------------------------------------------------------------- #
WS="$TMP/case2"
BOARD_IP='# Board — demo

## Backlog
- T-002 second card — touches: b

## In Progress
- T-001 first card — touches: a

## Review
- (none)

## Done
- (none)
'
mk_workspace "$WS" "demo" "$BOARD_IP"
cat > "$WS/.loom/demo/tasks/T-001.done.md" <<EOF
---
status: green
notes: ""
---
EOF
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.done.md"

expected='# Board — demo

## Backlog
- T-002 second card — touches: b

## In Progress
- (none)

## Review
- T-001 first card — touches: a

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 2"
pass "case 2: done.md green → In Progress → Review"

# --------------------------------------------------------------------------- #
# Case 3 — done.md status: failed with card already In Progress + [failed]:
#           file must NOT be rewritten (mtime unchanged).
# --------------------------------------------------------------------------- #
WS="$TMP/case3"
BOARD_FAILED='# Board — demo

## Backlog
- (none)

## In Progress
- [failed] T-001 first card — touches: a

## Review
- (none)

## Done
- (none)
'
mk_workspace "$WS" "demo" "$BOARD_FAILED"
cat > "$WS/.loom/demo/tasks/T-001.done.md" <<EOF
---
status: failed
notes: tests still red
---
EOF
before_mt="$(mtime "$WS/.loom/demo/board.md")"
before_sum="$(cat "$WS/.loom/demo/board.md")"
# Sleep a touch to ensure any rewrite would change mtime.
sleep 0.05
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.done.md"
after_mt="$(mtime "$WS/.loom/demo/board.md")"
after_sum="$(cat "$WS/.loom/demo/board.md")"
[ "$before_sum" = "$after_sum" ] || fail "case 3: board content changed unexpectedly"
[ "$before_mt" = "$after_mt" ] || fail "case 3: board mtime changed despite no-op (idempotent guard failed)"
pass "case 3: failed→failed no-op leaves board untouched (content + mtime)"

# --------------------------------------------------------------------------- #
# Case 3b — done.md status: failed transitions from Backlog → In Progress
# with [failed] annotation
# --------------------------------------------------------------------------- #
WS="$TMP/case3b"
mk_workspace "$WS" "demo" "$BOARD_BASE"
cat > "$WS/.loom/demo/tasks/T-001.done.md" <<EOF
---
status: failed
notes: red
---
EOF
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.done.md"
expected='# Board — demo

## Backlog
- T-002 second card — touches: b

## In Progress
- [failed] T-001 first card — touches: a

## Review
- (none)

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 3b"
pass "case 3b: failed status applies [failed] annotation"

# --------------------------------------------------------------------------- #
# Case 4 — done.md status: hitl-block with notes → Backlog with [HITL-blocked: <first line>]
# --------------------------------------------------------------------------- #
WS="$TMP/case4"
BOARD_IP2='# Board — demo

## Backlog
- T-002 second card — touches: b

## In Progress
- T-001 first card — touches: a

## Review
- (none)

## Done
- (none)
'
mk_workspace "$WS" "demo" "$BOARD_IP2"
cat > "$WS/.loom/demo/tasks/T-001.done.md" <<'EOF'
---
status: hitl-block
notes: |
  needs API key from human
  second line ignored
---
EOF
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.done.md"
expected='# Board — demo

## Backlog
- T-002 second card — touches: b
- [HITL-blocked: needs API key from human] T-001 first card — touches: a

## In Progress
- (none)

## Review
- (none)

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 4"
pass "case 4: hitl-block with notes → [HITL-blocked: <first line>]"

# --------------------------------------------------------------------------- #
# Case 5 — done.md status: hitl-block without notes → [HITL-blocked: see done.md]
# --------------------------------------------------------------------------- #
WS="$TMP/case5"
mk_workspace "$WS" "demo" "$BOARD_IP2"
cat > "$WS/.loom/demo/tasks/T-001.done.md" <<'EOF'
---
status: hitl-block
---
EOF
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.done.md"
expected='# Board — demo

## Backlog
- T-002 second card — touches: b
- [HITL-blocked: see done.md] T-001 first card — touches: a

## In Progress
- (none)

## Review
- (none)

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 5"
pass "case 5: hitl-block w/o notes → [HITL-blocked: see done.md]"

# --------------------------------------------------------------------------- #
# Case 6 — smoke-report all-PASS → all Review cards promoted to Done
# --------------------------------------------------------------------------- #
WS="$TMP/case6"
BOARD_REVIEW='# Board — demo

## Backlog
- T-099 backlog stays — touches: b

## In Progress
- T-050 inprog stays — touches: x

## Review
- T-001 first card — touches: a
- T-002 second card — touches: b

## Done
- (none)
'
mk_workspace "$WS" "demo" "$BOARD_REVIEW"
cat > "$WS/.loom/demo/smoke-report.md" <<'EOF'
# Smoke report

- Step: launch
  **Result:** PASS

- Step: health
  **Result:** PASS
EOF
run_hook "$WS" "Write" "$WS/.loom/demo/smoke-report.md"
expected='# Board — demo

## Backlog
- T-099 backlog stays — touches: b

## In Progress
- T-050 inprog stays — touches: x

## Review
- (none)

## Done
- T-001 first card — touches: a
- T-002 second card — touches: b
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 6"
pass "case 6: smoke all-PASS promotes Review → Done; other columns untouched"

# --------------------------------------------------------------------------- #
# Case 7 — smoke-report with a FAIL → Review unchanged
# --------------------------------------------------------------------------- #
WS="$TMP/case7"
mk_workspace "$WS" "demo" "$BOARD_REVIEW"
cat > "$WS/.loom/demo/smoke-report.md" <<'EOF'
# Smoke report

- Step: launch
  **Result:** PASS

- Step: health
  **Result:** FAIL
EOF
before_sum="$(cat "$WS/.loom/demo/board.md")"
run_hook "$WS" "Write" "$WS/.loom/demo/smoke-report.md"
after_sum="$(cat "$WS/.loom/demo/board.md")"
[ "$before_sum" = "$after_sum" ] || fail "case 7: smoke FAIL must not move Review cards"
pass "case 7: smoke with FAIL leaves Review intact"

# --------------------------------------------------------------------------- #
# Case 8 — idempotency: re-firing the same trigger leaves file untouched
#           (content + mtime unchanged on the second invocation).
# --------------------------------------------------------------------------- #
WS="$TMP/case8"
mk_workspace "$WS" "demo" "$BOARD_BASE"
echo "RED: failing" > "$WS/.loom/demo/tasks/T-001.test-log.txt"
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.test-log.txt"
between_mt="$(mtime "$WS/.loom/demo/board.md")"
between_sum="$(cat "$WS/.loom/demo/board.md")"
sleep 0.05
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-001.test-log.txt"
after_mt="$(mtime "$WS/.loom/demo/board.md")"
after_sum="$(cat "$WS/.loom/demo/board.md")"
[ "$between_sum" = "$after_sum" ] || fail "case 8: second trigger changed board content"
[ "$between_mt" = "$after_mt" ] || fail "case 8: second trigger changed board mtime (idempotency broken)"
pass "case 8: idempotent — re-fire is a no-op (content + mtime)"

# --------------------------------------------------------------------------- #
# Case 9 — fast-path: tool_name = Read → no change
# --------------------------------------------------------------------------- #
WS="$TMP/case9"
mk_workspace "$WS" "demo" "$BOARD_BASE"
echo "anything" > "$WS/.loom/demo/tasks/T-001.test-log.txt"
before_sum="$(cat "$WS/.loom/demo/board.md")"
run_hook "$WS" "Read" "$WS/.loom/demo/tasks/T-001.test-log.txt"
after_sum="$(cat "$WS/.loom/demo/board.md")"
[ "$before_sum" = "$after_sum" ] || fail "case 9: Read should be a no-op"
pass "case 9: fast-path Read → no change"

# --------------------------------------------------------------------------- #
# Case 10 — fast-path: file outside `.loom/<project>/` → no change
# --------------------------------------------------------------------------- #
WS="$TMP/case10"
mk_workspace "$WS" "demo" "$BOARD_BASE"
mkdir -p "$WS/src"
echo "hi" > "$WS/src/some-file.ts"
before_sum="$(cat "$WS/.loom/demo/board.md")"
run_hook "$WS" "Write" "$WS/src/some-file.ts"
after_sum="$(cat "$WS/.loom/demo/board.md")"
[ "$before_sum" = "$after_sum" ] || fail "case 10: out-of-workspace path should not mutate board"
pass "case 10: fast-path path outside .loom/<project>/ → no change"

# --------------------------------------------------------------------------- #
# Case 11 — missing `.loom/.active` → no change, exit 0
# --------------------------------------------------------------------------- #
WS="$TMP/case11"
mkdir -p "$WS/.loom/demo/tasks"
# NO .loom/.active file written.
echo "anything" > "$WS/.loom/demo/tasks/T-001.test-log.txt"
# board.md absent; the hook must still exit 0 silently.
out="$(python3 -c "import json,sys; sys.stdout.write(json.dumps({'tool_name': 'Write', 'tool_input': {'file_path': sys.argv[1]}, 'cwd': sys.argv[2]}))" "$WS/.loom/demo/tasks/T-001.test-log.txt" "$WS" | python3 "$HOOK" 2>&1)"
rc=$?
[ "$rc" = "0" ] || fail "case 11: missing .active should still exit 0 (got rc=$rc, out=$out)"
[ -z "$out" ] || fail "case 11: missing .active should be silent (got: $out)"
pass "case 11: missing .loom/.active → silent exit 0"

# --------------------------------------------------------------------------- #
# Case 12 — [HITL] structural annotation preserved across transition
# --------------------------------------------------------------------------- #
WS="$TMP/case12"
BOARD_HITL='# Board — demo

## Backlog
- [HITL] T-005 hitl card — touches: a

## In Progress
- (none)

## Review
- (none)

## Done
- (none)
'
mk_workspace "$WS" "demo" "$BOARD_HITL"
echo "RED: failing" > "$WS/.loom/demo/tasks/T-005.test-log.txt"
run_hook "$WS" "Write" "$WS/.loom/demo/tasks/T-005.test-log.txt"
expected='# Board — demo

## Backlog
- (none)

## In Progress
- [HITL] T-005 hitl card — touches: a

## Review
- (none)

## Done
- (none)
'
diff_board "$WS/.loom/demo/board.md" "$expected" "case 12"
pass "case 12: structural [HITL] annotation preserved across transition"

echo
echo "all cases passed"
