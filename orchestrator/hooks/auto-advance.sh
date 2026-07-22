#!/usr/bin/env bash
set -euo pipefail

# Per ADR-002 as amended (docs/orchestrator/hooks.md § Session ownership),
# the session-ownership store is written primarily by the UserPromptSubmit
# hook (pin-on-weave.sh). This hook's only write is converting THIS
# session's weave-intent marker into a pin once the orchestrator has
# resolved the project name into `.loom/.active` — it never claims work
# for a session that didn't type /weave.
#
# The advance nudge fires only for the session pinned to the project.
# Unpinned or unidentifiable sessions get silence — never a scan of other
# workspaces, never an opportunistic claim.

input="$(cat 2>/dev/null || true)"
if [ -n "$input" ] && [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)" = "true" ]; then
    exit 0
fi

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parser="$(cd "$hook_dir/../weave/lib" && pwd)/pipeline-parser.py"
store_lib="$hook_dir/../lib/telemetry/session-store.sh"

emit_advance() {
    local pipeline="$1"
    local project phase reason
    project="$(basename "$(dirname "$pipeline")")"
    phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || echo "?")"
    reason="Loom project '$project' is ready to advance in $phase. Run \`/weave $project\`."
    jq -cn --arg reason "$reason" '{decision:"block",reason:$reason}'
}

# Unidentifiable session: emit the diagnostic marker and stay silent.
bail_silent() {
    local marker="${1:-LOOM_SESSION_FALLBACK=1}"
    printf '%s\n' "$marker" >&2
    exit 0
}

resolve_loom_root() {
    local cwd="$1"
    local dir="$cwd"
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

pinned_pipeline() {
    local loom_root="$1"
    local project="$2"
    local pipeline="$loom_root/$project/pipeline.md"
    [ -f "$pipeline" ] || return 1
    local status pending phase
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    pending="$("$parser" field "$pipeline" "Pending user input" 2>/dev/null || true)"
    [ "$status" = "Pending" ] || return 1
    [ -z "$pending" ] || return 1
    phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || true)"
    case "$phase" in
        design|plan|build|review) ;;
        *) return 1 ;;
    esac
    printf '%s' "$pipeline"
}

[ -n "$input" ] || bail_silent
printf '%s' "$input" | jq -e . >/dev/null 2>&1 || bail_silent

session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"

[ -n "$session_id" ] || bail_silent
case "$session_id" in
    */*|*..*|.*) bail_silent LOOM_PIN_REJECTED_SID=1 ;;
esac
# shellcheck disable=SC1090
source "$store_lib" 2>/dev/null || bail_silent LOOM_SESSION_STORE_MISSING=1

loom_root=""
if [ -n "$cwd" ]; then
    loom_root="$(resolve_loom_root "$cwd" || true)"
fi
[ -n "$loom_root" ] || loom_root="${LOOM_ROOT:-.loom}"
[ -d "$loom_root" ] || exit 0

pinned_project="$(session_store_read "$loom_root" "$session_id" || true)"

if [ -z "$pinned_project" ]; then
    # No pin. Adopt one only if THIS session declared weave intent
    # (pin-on-weave.sh dropped a marker because /weave was invoked with
    # a ticket id, free text, or an ambiguous bare form) and the
    # orchestrator has since resolved the project into .loom/.active.
    # Sessions without the marker never typed /weave: not our audience.
    intent="$loom_root/.sessions/$session_id.weave-intent"
    [ -f "$intent" ] || exit 0
    active="$(cat "$loom_root/.active" 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -z "$active" ] || [ ! -d "$loom_root/$active" ]; then
        exit 0
    fi
    # Never adopt a harness-driven eval run: run-baseline.sh points
    # .loom/.active at the eval project while driving it to completion in a
    # single invocation, so an interactive session that happened to declare
    # weave-intent must not pin itself to it.
    if [ -f "$loom_root/$active/.eval-run" ]; then
        printf 'LOOM_SKIP_EVAL_RUN=%s\n' "$active" >&2
        exit 0
    fi
    session_store_write "$loom_root" "$session_id" "$active" 2>/dev/null || exit 0
    rm -f "$intent" 2>/dev/null || true
    pinned_project="$active"
fi

if [ ! -d "$loom_root/$pinned_project" ]; then
    printf 'LOOM_SESSION_STALE=%s\n' "$session_id" >&2
    exit 0
fi

pipeline="$(pinned_pipeline "$loom_root" "$pinned_project")" || exit 0
emit_advance "$pipeline"
