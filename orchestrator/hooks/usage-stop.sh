#!/usr/bin/env bash
set -uo pipefail

[ "${LOOM_TELEMETRY:-1}" = "0" ] && exit 0
input="$(cat 2>/dev/null || true)"
run_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$run_id" ] || exit 0
root="${LOOM_ROOT:-.loom}"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for dir in "$root"/*; do
    [ -d "$dir" ] || continue
    [ -f "$dir/usage-$run_id.jsonl" ] || continue
    project="$(basename "$dir")"
    jq -cn --arg ts "$ts" --arg run "$run_id" --arg project "$project" \
        '{"schema-version":1,ts:$ts,"run-id":$run,project:$project,event:"run-end"}' \
        >> "$dir/usage-$run_id.jsonl" 2>/dev/null || true
done
