#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"
if [ -n "$input" ] && [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)" = "true" ]; then
    exit 0
fi

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parser="$(cd "$hook_dir/../weave/lib" && pwd)/pipeline-parser.py"
store_lib="$hook_dir/../lib/telemetry/session-store.sh"

scan_pending_candidate() {
    local loom_root="$1"
    local exclude_project="${2:-}"
    local pipeline status pending phase candidate=""
    local found=0
    while IFS= read -r -d '' pipeline; do
        local project
        project="$(basename "$(dirname "$pipeline")")"
        [ -n "$exclude_project" ] && [ "$project" = "$exclude_project" ] && continue
        status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
        pending="$("$parser" field "$pipeline" "Pending user input" 2>/dev/null || true)"
        [ "$status" = "Pending" ] || continue
        [ -z "$pending" ] || continue
        phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || true)"
        case "$phase" in
            design|plan|build|review) ;;
            *) continue ;;
        esac
        found=$((found + 1))
        candidate="$pipeline"
    done < <(find "$loom_root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)
    [ "$found" -eq 1 ] || return 1
    printf '%s' "$candidate"
}

emit_advance() {
    local pipeline="$1"
    local project phase reason
    project="$(basename "$(dirname "$pipeline")")"
    phase="$("$parser" field "$pipeline" "Current phase")"
    reason="Loom project '$project' is ready to advance in $phase. Run \`/weave $project\`."
    jq -cn --arg reason "$reason" '{decision:"block",reason:$reason}'
}

run_fallback() {
    local marker="${1:-LOOM_SESSION_FALLBACK=1}"
    local loom_root="${LOOM_ROOT:-.loom}"
    printf '%s\n' "$marker" >&2
    [ -d "$loom_root" ] || exit 0
    local candidate
    candidate="$(scan_pending_candidate "$loom_root")" || exit 0
    emit_advance "$candidate"
    exit 0
}

resolve_loom_root() {
    local cwd="$1"
    local dir="$cwd"
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

[ -n "$input" ] || run_fallback
printf '%s' "$input" | jq -e . >/dev/null 2>&1 || run_fallback

session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"

[ -n "$session_id" ] || run_fallback
# shellcheck disable=SC1090
source "$store_lib" 2>/dev/null || run_fallback LOOM_SESSION_STORE_MISSING=1

loom_root=""
if [ -n "$cwd" ]; then
    loom_root="$(resolve_loom_root "$cwd" || true)"
fi
[ -n "$loom_root" ] || loom_root="${LOOM_ROOT:-.loom}"
[ -d "$loom_root" ] || exit 0

pinned_project="$(session_store_read "$loom_root" "$session_id")"

if [ -n "$pinned_project" ]; then
    if [ -d "$loom_root/$pinned_project" ]; then
        pipeline="$(pinned_pipeline "$loom_root" "$pinned_project")" || exit 0
        emit_advance "$pipeline"
        exit 0
    fi
    printf 'LOOM_SESSION_STALE=%s\n' "$session_id" >&2
fi

candidate="$(scan_pending_candidate "$loom_root")" || exit 0
project="$(basename "$(dirname "$candidate")")"
session_store_write "$loom_root" "$session_id" "$project"
emit_advance "$candidate"
