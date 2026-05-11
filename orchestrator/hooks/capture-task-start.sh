#!/usr/bin/env bash
set -uo pipefail

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
[ "$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)" = "Task" ] || exit 0

description="$(printf '%s' "$input" | jq -r '.tool_input.description // empty' 2>/dev/null || true)"
case "$description" in
    loom-*|weave-*) ;;
    *) exit 0 ;;
esac

root="${LOOM_ROOT:-.loom}"
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/pipeline-parser.py"
project=""
while IFS= read -r -d '' pipeline; do
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    if [ "$status" = "Pending" ] || [ "$status" = "blocked" ] || [ "$status" = "failed" ]; then
        [ -z "$project" ] || exit 0
        project="$(basename "$(dirname "$pipeline")")"
    fi
done < <(find "$root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)

[ -n "$project" ] || exit 0
dir="$root/$project/.in-flight"
mkdir -p "$dir" 2>/dev/null || exit 0
safe="$(printf '%s' "$description" | tr -c 'A-Za-z0-9._-' '_')"
date -u +%s > "$dir/$safe.start" 2>/dev/null || true
