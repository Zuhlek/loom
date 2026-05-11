#!/usr/bin/env bash
set -euo pipefail

cat >/dev/null || true

root="${LOOM_ROOT:-.loom}"
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/pipeline-parser.py"
[ -d "$root" ] || exit 0

lines=()
while IFS= read -r -d '' pipeline; do
    project="$(basename "$(dirname "$pipeline")")"
    phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || true)"
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    pending="$("$parser" field "$pipeline" "Pending user input" 2>/dev/null || true)"
    case "$status" in
        Pending|blocked|failed)
            suffix=""
            [ -n "$pending" ] && suffix="; user input pending"
            lines+=("- $project: $phase/$status$suffix")
            ;;
    esac
done < <(find "$root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)

[ "${#lines[@]}" -gt 0 ] || exit 0

context="Active Loom workspace(s):"$'\n'
for line in "${lines[@]}"; do
    context+="$line"$'\n'
done
context+="Run \`/weave <project>\` to continue."

jq -cn --arg ctx "$context" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
