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
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/pipeline-parser.py"
project=""
while IFS= read -r -d '' pipeline; do
    status="$("$parser" field "$pipeline" "Phase status" 2>/dev/null || true)"
    case "$status" in Pending|blocked|failed) project="$(basename "$(dirname "$pipeline")")"; break ;; esac
done < <(find "$root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)
[ -n "$project" ] || exit 0

run_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$run_id" ] || exit 0
dir="$root/$project/.in-flight"
mkdir -p "$dir" 2>/dev/null || exit 0
seq_file="$dir/usage.seq"
seq=1
[ -f "$seq_file" ] && seq=$(( $(cat "$seq_file" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$seq" > "$seq_file" 2>/dev/null || true
dispatch_id="$run_id:$seq"
safe="$(printf '%s' "$description" | tr -c 'A-Za-z0-9._-' '_')"
printf '%s' "$dispatch_id" > "$dir/$safe.dispatch-id" 2>/dev/null || true
bytes="$(printf '%s' "$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty' 2>/dev/null || true)" | wc -c | tr -d ' ')"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -cn --arg ts "$ts" --arg run "$run_id" --arg project "$project" --arg did "$dispatch_id" --arg desc "$description" --argjson bytes "$bytes" \
    '{"schema-version":1,ts:$ts,"run-id":$run,project:$project,event:"dispatch-start","dispatch-id":$did,"task-description":$desc,"eager-load-bytes":$bytes}' \
    >> "$root/$project/usage-$run_id.jsonl" 2>/dev/null || true
