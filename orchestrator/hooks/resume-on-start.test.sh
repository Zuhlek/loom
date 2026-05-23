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
    mkdir -p "$loom_root/$project"
    cat > "$loom_root/$project/pipeline.md" <<'EOF'
## Current phase
plan
## Phase status
Pending
## Lifecycle state
active
EOF
}

snapshot_sessions() {
    local loom_root="$1"
    [ -d "$loom_root/.sessions" ] || { printf ''; return; }
    (cd "$loom_root/.sessions" && find . -type f -print0 | sort -z | xargs -0 -I{} sh -c 'printf "%s\t" "{}"; cat "{}"')
}

# Case 1 — empty stdin: FALLBACK marker on stderr, legacy global-scan body on stdout.
loom_root="$TMP/case1/.loom"
seed_pending_pipeline "$loom_root" "alpha"
before="$(snapshot_sessions "$loom_root")"
out="$(printf '' | LOOM_ROOT="$loom_root" bash "$HOOK" 2>"$TMP/case1.err")" || fail "case 1: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 1: .sessions/ mutated by hook"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case1.err" || fail "case 1: missing LOOM_SESSION_FALLBACK=1 stderr marker"
echo "$out" | grep -q 'alpha' || fail "case 1: legacy global-scan did not surface alpha"
echo "$out" | grep -q 'Run `/weave <project>` to continue' || fail "case 1: legacy reminder text missing"
pass "case 1: empty stdin falls back with stderr marker"

# Case 2 — malformed JSON: FALLBACK.
loom_root="$TMP/case2/.loom"
seed_pending_pipeline "$loom_root" "alpha"
before="$(snapshot_sessions "$loom_root")"
out="$(printf 'not json {{{' | LOOM_ROOT="$loom_root" bash "$HOOK" 2>"$TMP/case2.err")" || fail "case 2: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 2: .sessions/ mutated"
grep -q 'LOOM_SESSION_FALLBACK=1' "$TMP/case2.err" || fail "case 2: missing fallback marker"
echo "$out" | grep -q 'alpha' || fail "case 2: alpha not in legacy output"
pass "case 2: malformed JSON falls back"

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
if echo "$out" | grep -q 'projectY'; then
    fail "case 3: projectY leaked under pinned session"
fi
pass "case 3: OWNED scopes additionalContext to pinned project"

# Case 4 — NO-OWNER with projectY owned by a different session, projectZ unowned: only Z surfaces.
loom_root="$TMP/case4/.loom"
seed_pending_pipeline "$loom_root" "projectY"
seed_pending_pipeline "$loom_root" "projectZ"
session_store_write "$loom_root" "sess-other" "projectY"
cwd="$TMP/case4"
before="$(snapshot_sessions "$loom_root")"
payload="$(jq -cn --arg sid "sess-fresh" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case4.err")" || fail "case 4: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 4: .sessions/ mutated under NO-OWNER"
echo "$out" | grep -q 'projectZ' || fail "case 4: unowned projectZ missing from additionalContext"
if echo "$out" | grep -q 'projectY'; then
    fail "case 4: projectY (owned by other) leaked into NO-OWNER scope"
fi
pass "case 4: NO-OWNER filters workspaces owned by other sessions"

# Case 5 — NO-OWNER with all projects owned by other sessions: silent exit (empty stdout).
loom_root="$TMP/case5/.loom"
seed_pending_pipeline "$loom_root" "projectA"
seed_pending_pipeline "$loom_root" "projectB"
session_store_write "$loom_root" "sess-x" "projectA"
session_store_write "$loom_root" "sess-y" "projectB"
cwd="$TMP/case5"
before="$(snapshot_sessions "$loom_root")"
payload="$(jq -cn --arg sid "sess-fresh" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>"$TMP/case5.err")" || fail "case 5: hook exited non-zero"
after="$(snapshot_sessions "$loom_root")"
[ "$before" = "$after" ] || fail "case 5: .sessions/ mutated under exhausted NO-OWNER"
[ -z "$out" ] || fail "case 5: expected empty stdout, got '$out'"
pass "case 5: NO-OWNER with all projects owned exits silent"

# Case 6 — preserve stdout JSON shape (hookSpecificOutput / SessionStart).
loom_root="$TMP/case6/.loom"
seed_pending_pipeline "$loom_root" "alpha"
cwd="$TMP/case6"
payload="$(jq -cn --arg sid "sess-fresh" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 6: hook exited non-zero"
echo "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null \
    || fail "case 6: stdout shape missing hookSpecificOutput.hookEventName=SessionStart"
echo "$out" | jq -e '.hookSpecificOutput.additionalContext | type == "string"' >/dev/null \
    || fail "case 6: additionalContext not a string"
pass "case 6: stdout JSON envelope preserved"

# Case 7 — payload-cwd supersedes shell PWD for LOOM_ROOT resolution.
loom_root="$TMP/case7/.loom"
seed_pending_pipeline "$loom_root" "fromcwd"
cwd="$TMP/case7"
payload="$(jq -cn --arg sid "sess-fresh" --arg cwd "$cwd" '{session_id:$sid, cwd:$cwd}')"
out="$(cd "$TMP" && printf '%s' "$payload" | bash "$HOOK" 2>/dev/null)" || fail "case 7: hook exited non-zero"
echo "$out" | grep -q 'fromcwd' || fail "case 7: LOOM_ROOT not resolved from payload cwd"
pass "case 7: payload cwd resolves LOOM_ROOT"

echo
echo "all cases passed"
