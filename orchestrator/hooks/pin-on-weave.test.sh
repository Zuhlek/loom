#!/usr/bin/env bash
# Behaviour test for pin-on-weave.sh. Run from anywhere:
#   bash orchestrator/hooks/pin-on-weave.test.sh

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pin-on-weave.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

seed_pipeline() {
    mkdir -p "$1/$2"
    printf '## Current phase\nplan\n## Phase status\nPending\n' > "$1/$2/pipeline.md"
}

payload() {
    jq -cn --arg sid "$1" --arg cwd "$2" --arg prompt "$3" \
        '{session_id:$sid, cwd:$cwd, prompt:$prompt}'
}

pin_of()    { cat "$1/.sessions/$2.txt" 2>/dev/null || true; }
intent_of() { [ -f "$1/.sessions/$2.weave-intent" ] && echo yes || echo no; }
rc_of()     { "$@" >/dev/null 2>&1; echo $?; }

# Case 1 — explicit existing project: /weave alpha pins alpha, stdout empty.
root="$TMP/case1"; seed_pipeline "$root/.loom" "alpha"
out="$(payload sess-1 "$root" "/weave alpha" | bash "$HOOK" 2>/dev/null)" || fail "case 1: non-zero exit"
[ -z "$out" ] || fail "case 1: stdout must be empty, got '$out'"
[ "$(pin_of "$root/.loom" sess-1)" = "alpha" ] || fail "case 1: pin not written"
pass "case 1: /weave <existing> pins and stays silent"

# Case 2 — bare /weave with a single workspace pins it.
root="$TMP/case2"; seed_pipeline "$root/.loom" "solo"
payload sess-2 "$root" "/weave" | bash "$HOOK" 2>/dev/null || fail "case 2: non-zero exit"
[ "$(pin_of "$root/.loom" sess-2)" = "solo" ] || fail "case 2: sole workspace not pinned"
pass "case 2: bare /weave pins the sole workspace"

# Case 3 — bare /weave with two workspaces: ambiguous → intent marker, no pin.
root="$TMP/case3"; seed_pipeline "$root/.loom" "one"; seed_pipeline "$root/.loom" "two"
payload sess-3 "$root" "/weave" | bash "$HOOK" 2>/dev/null || fail "case 3: non-zero exit"
[ -z "$(pin_of "$root/.loom" sess-3)" ] || fail "case 3: ambiguous bare /weave must not pin"
[ "$(intent_of "$root/.loom" sess-3)" = "yes" ] || fail "case 3: ambiguous bare /weave must drop intent marker"
pass "case 3: ambiguous bare /weave → intent marker, no pin"

# Case 4 — non-weave prompt: nothing written.
root="$TMP/case4"; seed_pipeline "$root/.loom" "alpha"
payload sess-4 "$root" "fix the flaky test please" | bash "$HOOK" 2>/dev/null || fail "case 4: non-zero exit"
[ ! -d "$root/.loom/.sessions" ] || fail "case 4: non-weave prompt must not touch the store"
pass "case 4: unrelated prompt writes nothing"

# Case 5 — expanded command envelope pins from <command-args>.
root="$TMP/case5"; seed_pipeline "$root/.loom" "alpha"
prompt='<command-message>weave</command-message><command-name>/weave</command-name><command-args>alpha</command-args>'
payload sess-5 "$root" "$prompt" | bash "$HOOK" 2>/dev/null || fail "case 5: non-zero exit"
[ "$(pin_of "$root/.loom" sess-5)" = "alpha" ] || fail "case 5: envelope form not pinned"
pass "case 5: command envelope form pins"

# Case 6 — path-shaped argument is rejected (no pin, no intent).
root="$TMP/case6"; seed_pipeline "$root/.loom" "alpha"
payload sess-6 "$root" "/weave ../evil" | bash "$HOOK" 2>"$TMP/case6.err" || fail "case 6: non-zero exit"
[ -z "$(pin_of "$root/.loom" sess-6)" ] || fail "case 6: path-shaped arg must not pin"
[ "$(intent_of "$root/.loom" sess-6)" = "no" ] || fail "case 6: rejected arg must not drop intent"
grep -q 'LOOM_PIN_REJECTED_ARG' "$TMP/case6.err" || fail "case 6: missing rejection marker"
pass "case 6: path-shaped arg rejected"

# Case 7 — creation flow: no .loom yet, explicit project → intent marker (name is
# derived by the orchestrator, so we must not pin the raw token).
root="$TMP/case7"; mkdir -p "$root"
payload sess-7 "$root" "/weave brand-new" | bash "$HOOK" 2>/dev/null || fail "case 7: non-zero exit"
[ -z "$(pin_of "$root/.loom" sess-7)" ] || fail "case 7: creation flow must not hard-pin the raw token"
[ "$(intent_of "$root/.loom" sess-7)" = "yes" ] || fail "case 7: creation flow must drop intent marker"
pass "case 7: creation flow → intent marker under cwd/.loom"

# Case 8 — loom root resolves upward from a nested cwd, pins existing project.
root="$TMP/case8"; seed_pipeline "$root/.loom" "alpha"; mkdir -p "$root/src/deep"
payload sess-8 "$root/src/deep" "/weave alpha" | bash "$HOOK" 2>/dev/null || fail "case 8: non-zero exit"
[ "$(pin_of "$root/.loom" sess-8)" = "alpha" ] || fail "case 8: upward resolution failed"
pass "case 8: nested cwd resolves the workspace root"

# Case 9 — re-weave overwrites the pin.
root="$TMP/case9"; seed_pipeline "$root/.loom" "alpha"; seed_pipeline "$root/.loom" "beta"
payload sess-9 "$root" "/weave alpha" | bash "$HOOK" 2>/dev/null
payload sess-9 "$root" "/weave beta"  | bash "$HOOK" 2>/dev/null
[ "$(pin_of "$root/.loom" sess-9)" = "beta" ] || fail "case 9: pin not overwritten"
pass "case 9: later /weave re-pins the session"

# Case 10 — empty and malformed stdin exit zero, silently.
out="$(printf '' | bash "$HOOK" 2>/dev/null)" || fail "case 10: empty stdin crashed"
[ -z "$out" ] || fail "case 10: empty stdin produced output"
out="$(printf 'not json {{' | bash "$HOOK" 2>/dev/null)" || fail "case 10: malformed stdin crashed"
[ -z "$out" ] || fail "case 10: malformed stdin produced output"
pass "case 10: degenerate stdin is silent"

# Case 11 — hostile session_id with a path separator is rejected, nothing written.
root="$TMP/case11"; seed_pipeline "$root/.loom" "alpha"
out="$(payload "a/b" "$root" "/weave alpha" | bash "$HOOK" 2>"$TMP/case11.err")"; rc=$?
[ "$rc" -eq 0 ] || fail "case 11: hostile sid must exit 0, got rc=$rc"
[ -z "$out" ] || fail "case 11: hostile sid produced stdout"
grep -q 'LOOM_PIN_REJECTED_SID' "$TMP/case11.err" || fail "case 11: missing sid rejection marker"
[ ! -d "$root/.loom/.sessions" ] || fail "case 11: hostile sid created a store entry"
[ ! -e "$root/.loom/b.txt" ] || fail "case 11: hostile sid escaped into loom root"
pass "case 11: path-separator session_id rejected"

# Case 12 — .loom occupied by a FILE: exit 0, no crash (write failure is tolerated).
root="$TMP/case12"; mkdir -p "$root"; : > "$root/.loom"
rc="$(rc_of bash -c "printf '%s' '$(payload sess-12 "$root" "/weave alpha")' | bash '$HOOK'")"
[ "$rc" -eq 0 ] || fail "case 12: .loom-as-file must exit 0, got rc=$rc"
pass "case 12: .loom occupied by a file → exit 0"

# Case 13 — ticket id / non-existent project → intent marker, not a pin.
root="$TMP/case13"; seed_pipeline "$root/.loom" "alpha"
payload sess-13 "$root" "/weave CS-99" | bash "$HOOK" 2>/dev/null || fail "case 13: non-zero exit"
[ -z "$(pin_of "$root/.loom" sess-13)" ] || fail "case 13: non-existent project must not hard-pin"
[ "$(intent_of "$root/.loom" sess-13)" = "yes" ] || fail "case 13: non-existent project must drop intent"
pass "case 13: unknown project token → intent marker"

# Case 14 — flag-like argument rejected.
root="$TMP/case14"; seed_pipeline "$root/.loom" "alpha"
payload sess-14 "$root" "/weave --resume" | bash "$HOOK" 2>"$TMP/case14.err" || fail "case 14: non-zero exit"
[ -z "$(pin_of "$root/.loom" sess-14)" ] || fail "case 14: flag arg must not pin"
[ "$(intent_of "$root/.loom" sess-14)" = "no" ] || fail "case 14: flag arg must not drop intent"
grep -q 'LOOM_PIN_REJECTED_ARG' "$TMP/case14.err" || fail "case 14: missing rejection marker"
pass "case 14: leading-dash arg rejected"

# Case 15 — /weave only mid-sentence: not an invocation, nothing written.
root="$TMP/case15"; seed_pipeline "$root/.loom" "alpha"
payload sess-15 "$root" "please run /weave alpha for me" | bash "$HOOK" 2>/dev/null || fail "case 15: non-zero exit"
[ ! -d "$root/.loom/.sessions" ] || fail "case 15: mid-sentence /weave must not pin"
pass "case 15: mid-sentence /weave does not pin"

# Case 16 — injection payload in the arg is inert (no command execution).
root="$TMP/case16"; seed_pipeline "$root/.loom" "alpha"; canary="$TMP/CANARY16"
payload sess-16 "$root" "/weave \$(touch $canary)" | bash "$HOOK" 2>/dev/null || fail "case 16: non-zero exit"
[ ! -e "$canary" ] || fail "case 16: command substitution executed — injection!"
pass "case 16: injection in arg is treated as inert data"

# Case 17 — 1MB prompt without /weave returns promptly and writes nothing.
# (Built via --rawfile so the payload never lands on argv / hits ARG_MAX;
# the hook reads prompt from stdin, mirroring how Claude Code delivers it.)
root="$TMP/case17"; seed_pipeline "$root/.loom" "alpha"
head -c 1048576 /dev/zero | tr '\0' 'x' > "$TMP/big17.txt"
jq -cn --arg sid "sess-17" --arg cwd "$root" --rawfile prompt "$TMP/big17.txt" \
    '{session_id:$sid, cwd:$cwd, prompt:$prompt}' \
    | timeout 10 bash "$HOOK" 2>/dev/null || fail "case 17: non-zero exit / timeout on large prompt"
[ ! -d "$root/.loom/.sessions" ] || fail "case 17: large non-weave prompt must not pin"
pass "case 17: large non-weave prompt is silent and cheap"

# Case 18 — 1MB prompt that DOES start with /weave still resolves promptly.
root="$TMP/case18"; seed_pipeline "$root/.loom" "alpha"
{ printf '/weave alpha\n'; head -c 1048576 /dev/zero | tr '\0' 'x'; } > "$TMP/big18.txt"
jq -cn --arg sid "sess-18" --arg cwd "$root" --rawfile prompt "$TMP/big18.txt" \
    '{session_id:$sid, cwd:$cwd, prompt:$prompt}' \
    | timeout 10 bash "$HOOK" 2>/dev/null || fail "case 18: non-zero exit / timeout on large /weave prompt"
[ "$(pin_of "$root/.loom" sess-18)" = "alpha" ] || fail "case 18: large /weave prompt did not pin"
pass "case 18: large /weave prompt pins promptly (bounded prefix parse)"

echo
echo "all cases passed"
