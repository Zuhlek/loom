#!/usr/bin/env bash
set -uo pipefail

_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LIB_DIR="$(cd "$_HOOK_DIR/../lib" && pwd)"
. "$_LIB_DIR/events.sh" 2>/dev/null || exit 0
. "$_LIB_DIR/artifacts.sh" 2>/dev/null || exit 0

root="${LOOM_ROOT:-.loom}"
parser="$_LIB_DIR/pipeline-parser.py"
input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ -n "$tool" ] || exit 0

field() {
    printf '%s' "$input" | jq -r --arg key "$1" '.tool_input[$key] // empty' 2>/dev/null || true
}

project_from_path() {
    local path="$1"
    case "$path" in
        "$root"/*) rest="${path#"$root"/}"; printf '%s' "${rest%%/*}" ;;
        */"$root"/*) rest="${path#*"$root"/}"; printf '%s' "${rest%%/*}" ;;
    esac
}

active_project() {
    local hit=""
    while IFS= read -r -d '' pipeline; do
        status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
        case "$status" in
            Pending|blocked|failed)
                [ -z "$hit" ] || return 0
                hit="$(basename "$(dirname "$pipeline")")"
                ;;
        esac
    done < <(find "$root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)
    printf '%s' "$hit"
}

case "$tool" in
    Write|Edit|MultiEdit)
        path="$(field file_path)"
        project="$(project_from_path "$path")"
        [ -n "$project" ] || exit 0
        rel="${path#*"$root/$project/"}"
        payload="$(jq -cn --arg path "$rel" --arg tool "$tool" '{path:$path,tool:$tool}')"
        emit_event "$project" file-written "$payload" >/dev/null 2>&1 || true
        refresh_artifacts "$project" >/dev/null 2>&1 || true
        ;;
    Task)
        description="$(field description)"
        case "$description" in
            loom-*|weave-*) ;;
            *) exit 0 ;;
        esac
        project="$(active_project)"
        [ -n "$project" ] || exit 0
        phase="$("$parser" field "$root/$project/pipeline.md" "Current phase" 2>/dev/null || true)"
        safe="$(printf '%s' "$description" | tr -c 'A-Za-z0-9._-' '_')"
        start="$root/$project/.in-flight/$safe.start"
        duration=""
        if [ -f "$start" ]; then
            start_epoch="$(cat "$start" 2>/dev/null || true)"
            now_epoch="$(date -u +%s)"
            [ -n "$start_epoch" ] && duration=$((now_epoch - start_epoch))
            rm -f "$start" 2>/dev/null || true
        fi
        payload="$(jq -cn --arg phase "$phase" --arg desc "$description" --arg dur "$duration" '{phase:$phase,description:$desc,"duration-s":(if $dur=="" then null else ($dur|tonumber) end)}')"
        emit_event "$project" subagent-returned "$payload" >/dev/null 2>&1 || true
        ;;
    AskUserQuestion)
        project="$(active_project)"
        [ -n "$project" ] || exit 0
        question="$(field question)"
        payload="$(jq -cn --arg question "$question" '{question:$question}')"
        emit_event "$project" question-asked "$payload" >/dev/null 2>&1 || true
        ;;
esac
