#!/usr/bin/env bash
set -euo pipefail

# Per ADR-002 as amended (docs/orchestrator/hooks.md § Session ownership),
# this hook is read-only on the session-ownership store. Writes are owned
# by the UserPromptSubmit hook (pin-on-weave.sh) and the intent->pin
# adoption in auto-advance.sh.
#
# Sessions without a pin get no additionalContext at all: Loom speaks only
# to sessions that explicitly engaged a project via /weave. Discovery of
# resumable workspaces is pull-based — run /weave and the orchestrator's
# find-project method lists them.

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parser="$(cd "$hook_dir/../weave/lib" && pwd)/pipeline-parser.py"
store_lib="$hook_dir/../lib/telemetry/session-store.sh"

emit_context() {
    local context="$1"
    [ -n "$context" ] || return 0
    jq -cn --arg ctx "$context" \
        '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
}

# Print a status line for an actionable pipeline; return 1 (no output)
# when the status is not one a resume should nudge on (e.g. complete) or
# the file can't be parsed.
project_line() {
    local pipeline="$1"
    local project phase status pending suffix
    project="$(basename "$(dirname "$pipeline")")"
    phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || true)"
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    pending="$("$parser" field "$pipeline" "Pending user input" 2>/dev/null || true)"
    case "$status" in
        Pending|blocked|failed) ;;
        *) return 1 ;;
    esac
    suffix=""
    [ -n "$pending" ] && suffix="; user input pending"
    printf -- '- %s: %s/%s%s\n' "$project" "$phase" "$status" "$suffix"
}

resolve_loom_root() {
    local dir="$1"
    case "$dir" in
        /*) ;;
        *) return 1 ;;
    esac
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        if [ -d "$dir/.loom" ]; then
            printf '%s/.loom' "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# OWNED branch: scope additionalContext exclusively to the pinned project.
# Never aborts the hook: a pinned dir without a (readable, actionable)
# pipeline.md — the mid-creation state, or a finished project — resolves
# to silence, not a set -e failure.
emit_for_pinned_project() {
    local loom_root="$1"
    local project="$2"
    local pipeline="$loom_root/$project/pipeline.md"
    [ -f "$pipeline" ] || return 0
    local line
    line="$(project_line "$pipeline")" || return 0
    local context="Pinned Loom workspace:"$'\n'
    context+="${line%$'\n'}"$'\n'
    context+="Run \`/weave $project\` to continue."
    emit_context "$context"
}

raw_input="$(cat 2>/dev/null || true)"

session_id=""
payload_cwd=""
if [ -n "$raw_input" ]; then
    session_id="$(printf '%s' "$raw_input" | jq -r '.session_id // empty' 2>/dev/null || true)"
    payload_cwd="$(printf '%s' "$raw_input" | jq -r '.cwd // empty' 2>/dev/null || true)"
fi

# Unidentifiable session (older Claude Code, malformed payload, missing
# library): stay silent. Broadcasting a global scan to a session we can't
# attribute is exactly the cross-session noise this hook must not produce.
if [ -z "$session_id" ] || [ ! -f "$store_lib" ]; then
    [ -f "$store_lib" ] || printf 'LOOM_SESSION_STORE_MISSING=1\n' >&2
    printf 'LOOM_SESSION_FALLBACK=1\n' >&2
    exit 0
fi
case "$session_id" in
    */*|*..*|.*)
        printf 'LOOM_PIN_REJECTED_SID=1\n' >&2
        exit 0
        ;;
esac

# shellcheck disable=SC1090
source "$store_lib"

loom_root=""
if [ -n "$payload_cwd" ]; then
    loom_root="$(resolve_loom_root "$payload_cwd" || true)"
fi
[ -n "$loom_root" ] || loom_root="${LOOM_ROOT:-.loom}"

[ -d "$loom_root" ] || exit 0

pinned_project="$(session_store_read "$loom_root" "$session_id" || true)"

if [ -n "$pinned_project" ]; then
    if [ -d "$loom_root/$pinned_project" ]; then
        emit_for_pinned_project "$loom_root" "$pinned_project" || true
        exit 0
    fi
    printf 'LOOM_SESSION_STALE=%s\n' "$session_id" >&2
fi

# NO-OWNER (or stale pin): silent. Unpinned sessions hear nothing.
exit 0
