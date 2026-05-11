#!/usr/bin/env bash
set -euo pipefail

emit_event() {
    if [ "$#" -ne 3 ]; then
        echo "emit_event: expected project type payload" >&2
        return 2
    fi

    local project="$1"
    local type="$2"
    local payload="$3"
    local root="${LOOM_ROOT:-.loom}"
    local dir="$root/$project"
    local file="$dir/events.jsonl"
    mkdir -p "$dir"

    local ts
    ts="$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
PY
)"

    jq -cn \
        --arg ts "$ts" \
        --arg project "$project" \
        --arg type "$type" \
        --arg phase "${LOOM_PHASE:-}" \
        --arg correlation "${LOOM_CORRELATION_ID:-}" \
        --argjson payload "$payload" \
        '{ts:$ts, project:$project, type:$type, phase:(if $phase == "" then null else $phase end), "correlation-id":(if $correlation == "" then null else $correlation end), payload:$payload}' \
        >> "$file"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    emit_event "$@"
fi
