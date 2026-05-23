#!/usr/bin/env bash
# PostToolUse hook for Write/Edit/MultiEdit. When a tool wrote inside
# a .loom/<project>/ workspace, rebuild that workspace's
# artifacts.json index so consumers see the new file.
set -uo pipefail

_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LIB_DIR="$(cd "$_HOOK_DIR/../lib" && pwd)"
. "$_LIB_DIR/telemetry/artifacts.sh" 2>/dev/null || exit 0

root="${LOOM_ROOT:-.loom}"
input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
case "$tool" in
    Write|Edit|MultiEdit) ;;
    *) exit 0 ;;
esac

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$path" ] || exit 0

case "$path" in
    "$root"/*) rest="${path#"$root"/}"; project="${rest%%/*}" ;;
    */"$root"/*) rest="${path#*"$root"/}"; project="${rest%%/*}" ;;
    *) exit 0 ;;
esac

[ -n "$project" ] || exit 0
refresh_artifacts "$project" >/dev/null 2>&1 || true
