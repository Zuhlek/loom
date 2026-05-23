#!/usr/bin/env bash
set -euo pipefail

# Per ADR-002, this hook is read-only on the session-ownership store.
# Writes are owned exclusively by the Stop hook.

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parser="$(cd "$hook_dir/../weave/lib" && pwd)/pipeline-parser.py"
store_lib="$hook_dir/../lib/telemetry/session-store.sh"

emit_context() {
    local context="$1"
    [ -n "$context" ] || return 0
    jq -cn --arg ctx "$context" \
        '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
}

# Per-project status line as emitted by the legacy global-scan body.
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

collect_active_pipelines() {
    local loom_root="$1"
    [ -d "$loom_root" ] || return 0
    find "$loom_root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null
}

# Legacy unscoped behaviour. Reached when the hook can't identify the firing
# session (older Claude Code, malformed payload, missing library).
fallback_global_scan() {
    local loom_root="$1"
    local lines=()
    local pipeline line
    while IFS= read -r -d '' pipeline; do
        if line="$(project_line "$pipeline")"; then
            lines+=("${line%$'\n'}")
        fi
    done < <(collect_active_pipelines "$loom_root")
    [ "${#lines[@]}" -gt 0 ] || return 0
    local context="Active Loom workspace(s):"$'\n'
    for line in "${lines[@]}"; do
        context+="$line"$'\n'
    done
    context+="Run \`/weave <project>\` to continue."
    emit_context "$context"
}

# OWNED branch: scope additionalContext exclusively to the pinned project.
emit_for_pinned_project() {
    local loom_root="$1"
    local project="$2"
    local pipeline="$loom_root/$project/pipeline.md"
    [ -f "$pipeline" ] || return 1
    local line
    line="$(project_line "$pipeline")" || {
        local phase
        phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || echo "?")"
        line="- $project: $phase/active"
    }
    local context="Pinned Loom workspace:"$'\n'
    context+="${line%$'\n'}"$'\n'
    context+="Run \`/weave $project\` to continue."
    emit_context "$context"
}

# NO-OWNER branch: list active workspaces minus any owned by another session.
emit_for_no_owner() {
    local loom_root="$1"
    local session_id="$2"
    local pipelines=() filtered=()
    local pipeline project line
    while IFS= read -r -d '' pipeline; do
        pipelines+=("$pipeline")
    done < <(collect_active_pipelines "$loom_root")
    for pipeline in "${pipelines[@]}"; do
        project="$(basename "$(dirname "$pipeline")")"
        if session_store_owned_by_other "$loom_root" "$session_id" "$project"; then
            continue
        fi
        if line="$(project_line "$pipeline")"; then
            filtered+=("${line%$'\n'}")
        fi
    done
    [ "${#filtered[@]}" -gt 0 ] || return 0
    local context="Active Loom workspace(s):"$'\n'
    for line in "${filtered[@]}"; do
        context+="$line"$'\n'
    done
    context+="Run \`/weave <project>\` to continue."
    emit_context "$context"
}

raw_input="$(cat 2>/dev/null || true)"

session_id=""
payload_cwd=""
if [ -n "$raw_input" ]; then
    session_id="$(printf '%s' "$raw_input" | jq -r '.session_id // empty' 2>/dev/null || true)"
    payload_cwd="$(printf '%s' "$raw_input" | jq -r '.cwd // empty' 2>/dev/null || true)"
fi

if [ -z "$session_id" ] || [ ! -f "$store_lib" ]; then
    [ -f "$store_lib" ] || printf 'LOOM_SESSION_STORE_MISSING=1\n' >&2
    printf 'LOOM_SESSION_FALLBACK=1\n' >&2
    fallback_global_scan "${LOOM_ROOT:-.loom}"
    exit 0
fi

# shellcheck disable=SC1090
source "$store_lib"

if [ -n "$payload_cwd" ]; then
    loom_root="$payload_cwd/.loom"
else
    loom_root="${LOOM_ROOT:-.loom}"
fi

[ -d "$loom_root" ] || exit 0

pinned_project="$(session_store_read "$loom_root" "$session_id" || true)"

if [ -n "$pinned_project" ]; then
    if [ -d "$loom_root/$pinned_project" ]; then
        emit_for_pinned_project "$loom_root" "$pinned_project"
        exit 0
    fi
    printf 'LOOM_SESSION_STALE=%s\n' "$session_id" >&2
fi

emit_for_no_owner "$loom_root" "$session_id"
