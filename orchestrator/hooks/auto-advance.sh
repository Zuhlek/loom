#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"
if [ -n "$input" ] && [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)" = "true" ]; then
    exit 0
fi

root="${LOOM_ROOT:-.loom}"
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/pipeline-parser.py"
[ -d "$root" ] || exit 0

candidates=()
while IFS= read -r -d '' pipeline; do
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    pending="$("$parser" field "$pipeline" "Pending user input" 2>/dev/null || true)"
    [ "$status" = "Pending" ] || continue
    [ -z "$pending" ] || continue
    phase="$("$parser" field "$pipeline" "Current phase" 2>/dev/null || true)"
    case "$phase" in
        design|plan|build|review) candidates+=("$pipeline") ;;
    esac
done < <(find "$root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)

[ "${#candidates[@]}" -eq 1 ] || exit 0

project="$(basename "$(dirname "${candidates[0]}")")"
phase="$("$parser" field "${candidates[0]}" "Current phase")"
reason="Loom project '$project' is ready to advance in $phase. Run \`/weave $project\`."
jq -cn --arg reason "$reason" '{decision:"block",reason:$reason}'
