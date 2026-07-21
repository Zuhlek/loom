#!/usr/bin/env bash
# Smoke test for resume-on-start.sh. Run from anywhere:
#   bash orchestrator/hooks/resume-on-start.test.sh

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/resume-on-start.sh"
STORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/telemetry/session-store.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# shellcheck disable=SC1090
source "$STORE"

seed_pending_pipeline() {
    local loom_root="$1"
    local project="$2"
    local status="${3:-Pending}"
    mkdir -p "$loom_root/$project"
    cat > "$loom_root/$project/pipeline.md" <<EOF
## Current phase
plan
## Phase status
$status
## Lifecycle state
active
EOF
}

snapshot_sessions() {
    local loom_root="$1"
    [ -d "$loom_root/.sessions" ] || { printf ''; return; }
    (cd "$loom_root/.sessions" && find . -type f -print0 | sort -z | xargs -0 -I{} sh -c 'printf "%s\t" "{}"; cat "{}"')
}

# Case 1 — empty stdin: FALLBACK marker on stderr, SILENT stdout.
loom_root="$TMP/case1/.loom"
seed_pending_pipeline "$loom_root" "alpha"
before="$(snapshot_sessions "$loom_root")"
out="$(printf '' | LOOM_ROOT="$loom_root" bash "$HOOK" 2>"$TMP/case1.err")" || fail "case 1: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 1: .sessions/ mutated by hook"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case1.err" || fail "case 1: missing LOOM_SESSION_FALLBACK=1 stderr marker"
[ -z "$out" ] || fail "case 1: unidentifiable session must be silent, got '$out'"
pass "case 1: empty stdin → stderr marker, silent stdout"

# Case 2 — malformed JSON: marker, silent.
loom_root="$TMP/case2/.loom"
seed_pending_pipeline "$loom_root" "alpha"
out="$(printf 'not json {{{' | LOOM_ROOT="$loom_root" bash "$HOOK" 2>"$TMP/case2.err")" || fail "case 2: hook exited non-zero"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case2.err" || fail "case 2: missing fallback marker"
[ -z "$out" ] || fail "case 2: malformed JSON must be silent, got '$out'"
pass "case 2: malformed JSON → stderr marker, silent stdout"

# Case 3 — OWNED: pinned to projectX, surfaces only projectX even though projectY is Pending.
loom_root="$TMP/case3/.loom"
seed_pending_pipeline "$loom_root" "projectX"
seed_pending_pipeline "$loom_root" "projectY"
session_store_write "$loom_root" "sess-A" "projectX"
cwd="$TMP/case3"
before="$(snapshot_sessions "$loom_root")"
payload="$(jq -cn --arg sid "sess-A" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case3.err")" || fail "case 3: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 3: .sessions/ mutated under OWNED"
echo "$out" | grep -q 'projectX' || fail "case 3: pinned projectX missing from additionalContext"
echo "$out" | grep -q 'projectY' && fail "case 3: projectY leaked under pinned session"
pass "case 3: OWNED scopes additionalContext to pinned project"

# Case 4 — NO-OWNER: unpinned session sees NOTHING, even with unowned Pending workspaces.
loom_root="$TMP/case4/.loom"
seed_pending_pipeline "$loom_root" "projectY"
seed_pending_pipeline "$loom_root" "projectZ"
session_store_write "$loom_root" "sess-other" "projectY"
cwd="$TMP/case4"
payload="$(jq -cn --arg sid "sess-fresh" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case4.err")" || fail "case 4: hook exited non-zero"
[ -z "$out" ] || fail "case 4: unpinned session must be silent, got '$out'"
pass "case 4: NO-OWNER is silent — no workspace listing"

# Case 5 — stale pin (project deleted): stderr marker, silent stdout, record preserved.
loom_root="$TMP/case5/.loom"
seed_pending_pipeline "$loom_root" "projectA"
session_store_write "$loom_root" "sess-E" "ghostProject"
cwd="$TMP/case5"
payload="$(jq -cn --arg sid "sess-E" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case5.err")" || fail "case 5: hook exited non-zero"
grep -q 'LOOM_SESSION_STALE=sess-E' "$TMP/case5.err" || fail "case 5: missing LOOM_SESSION_STALE marker"
[ -z "$out" ] || fail "case 5: stale pin must not fall back to a listing, got '$out'"
[ -f "$loom_root/.sessions/sess-E.txt" ] || fail "case 5: stale record must not be deleted"
pass "case 5: stale pin → marker only, no fallthrough listing"

# Case 6 — preserve stdout JSON shape for pinned sessions.
loom_root="$TMP/case6/.loom"
seed_pending_pipeline "$loom_root" "alpha"
session_store_write "$loom_root" "sess-P" "alpha"
cwd="$TMP/case6"
payload="$(jq -cn --arg sid "sess-P" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 6: hook exited non-zero"
echo "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null \
    || fail "case 6: stdout shape missing hookSpecificOutput.hookEventName=SessionStart"
echo "$out" | jq -e '.hookSpecificOutput.additionalContext | type == "string"' >/dev/null \
    || fail "case 6: additionalContext not a string"
pass "case 6: stdout JSON envelope preserved"

# Case 7 — pinned dir exists but pipeline.md missing (mid-creation): exit 0, silent.
# Guards the set -e regression where `return 1` from emit_for_pinned_project
# aborted the hook.
loom_root="$TMP/case7/.loom"
mkdir -p "$loom_root/half-made"
session_store_write "$loom_root" "sess-H" "half-made"
cwd="$TMP/case7"
payload="$(jq -cn --arg sid "sess-H" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] || fail "case 7: pipeline-less pinned dir must exit 0, got rc=$rc"
[ -z "$out" ] || fail "case 7: pipeline-less pinned dir must be silent, got '$out'"
pass "case 7: pinned dir without pipeline.md → exit 0, silent"

# Case 8 — ancestor walk: pinned session started in a subdirectory still resolves.
loom_root="$TMP/case8/.loom"
seed_pending_pipeline "$loom_root" "alpha"
session_store_write "$loom_root" "sess-D" "alpha"
mkdir -p "$TMP/case8/src/deep/nested"
payload="$(jq -cn --arg sid "sess-D" --arg cwd "$TMP/case8/src/deep/nested" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 8: hook exited non-zero"
echo "$out" | grep -q 'alpha' || fail "case 8: ancestor walk failed to resolve .loom from subdir"
pass "case 8: nested cwd resolves the workspace root via ancestor walk"

# Case 9 — pinned project is complete: silent (no misleading active line).
loom_root="$TMP/case9/.loom"
seed_pending_pipeline "$loom_root" "done-proj" "complete"
session_store_write "$loom_root" "sess-C" "done-proj"
cwd="$TMP/case9"
payload="$(jq -cn --arg sid "sess-C" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 9: hook exited non-zero"
[ -z "$out" ] || fail "case 9: completed project must not emit resume context, got '$out'"
pass "case 9: completed pinned project → silent"

# Case 10 — hostile session_id with a path separator: rejected, silent, no read escape.
loom_root="$TMP/case10/.loom"
seed_pending_pipeline "$loom_root" "alpha"
cwd="$TMP/case10"
payload="$(jq -cn --arg sid "../escape" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case10.err")"; rc=$?
[ "$rc" -eq 0 ] || fail "case 10: hostile sid must exit 0, got rc=$rc"
[ -z "$out" ] || fail "case 10: hostile sid must be silent, got '$out'"
grep -q 'LOOM_PIN_REJECTED_SID' "$TMP/case10.err" || fail "case 10: missing sid rejection marker"
pass "case 10: path-separator session_id rejected, silent"

# Case 11 — weave-intent marker but no pin yet: SessionStart stays silent.
loom_root="$TMP/case11/.loom"
seed_pending_pipeline "$loom_root" "alpha"
mkdir -p "$loom_root/.sessions"
: > "$loom_root/.sessions/sess-I.weave-intent"
cwd="$TMP/case11"
payload="$(jq -cn --arg sid "sess-I" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 11: hook exited non-zero"
[ -z "$out" ] || fail "case 11: intent-only session must be silent until pinned, got '$out'"
pass "case 11: intent marker without pin → silent"

echo
echo "all cases passed"
