#!/usr/bin/env bash
set -uo pipefail

[ "${LOOM_TELEMETRY:-1}" = "0" ] && exit 0
input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
[ "$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)" = "Read" ] || exit 0

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$path" ] || exit 0
root="${LOOM_ROOT:-.loom}"
case "$path" in
    "$root"/*|*/"$root"/*) ;;
    *) exit 0 ;;
esac

project="${path#*"$root"/}"
project="${project%%/*}"
run_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$project" ] && [ -n "$run_id" ] || exit 0
file="$root/$project/usage-$run_id.jsonl"
bytes=0
[ -f "$path" ] && bytes="$(wc -c < "$path" | tr -d ' ')"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -cn --arg ts "$ts" --arg run "$run_id" --arg project "$project" --arg path "$path" --argjson bytes "$bytes" \
    '{"schema-version":1,ts:$ts,"run-id":$run,project:$project,event:"read","file-path":$path,"file-bytes":$bytes}' \
    >> "$file" 2>/dev/null || true
