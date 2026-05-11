#!/usr/bin/env bash
set -uo pipefail

[ "${LOOM_TELEMETRY:-1}" = "0" ] && exit 0
input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
[ "$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)" = "Task" ] || exit 0

description="$(printf '%s' "$input" | jq -r '.tool_input.description // empty' 2>/dev/null || true)"
case "$description" in
    loom-*|weave-*) ;;
    *) exit 0 ;;
esac

root="${LOOM_ROOT:-.loom}"
run_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$run_id" ] || exit 0
safe="$(printf '%s' "$description" | tr -c 'A-Za-z0-9._-' '_')"

for stash in "$root"/*/.in-flight/"$safe.dispatch-id"; do
    [ -f "$stash" ] || continue
    project="$(basename "$(dirname "$(dirname "$stash")")")"
    dispatch_id="$(cat "$stash" 2>/dev/null || true)"
    [ -n "$dispatch_id" ] || continue
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    input_tokens="$(printf '%s' "$input" | jq -r '.tool_response.usage.input_tokens // 0' 2>/dev/null || echo 0)"
    output_tokens="$(printf '%s' "$input" | jq -r '.tool_response.usage.output_tokens // 0' 2>/dev/null || echo 0)"
    jq -cn --arg ts "$ts" --arg run "$run_id" --arg project "$project" --arg did "$dispatch_id" --argjson input_tokens "$input_tokens" --argjson output_tokens "$output_tokens" \
        '{"schema-version":1,ts:$ts,"run-id":$run,project:$project,event:"dispatch-end","dispatch-id":$did,"input-tokens":$input_tokens,"output-tokens":$output_tokens}' \
        >> "$root/$project/usage-$run_id.jsonl" 2>/dev/null || true
    rm -f "$stash" 2>/dev/null || true
done
