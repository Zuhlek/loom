#!/usr/bin/env bash
set -euo pipefail

_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$_DIR/atomic-write.sh"

_kind_for_path() {
    case "$1" in
        pipeline.md) echo "state markdown false" ;;
        seed.md) echo "seed markdown false" ;;
        spec.md) echo "spec markdown true" ;;
        decisions.md) echo "decisions markdown false" ;;
        design.md) echo "design markdown true" ;;
        plan.md) echo "plan markdown true" ;;
        board.md) echo "board markdown false" ;;
        task.md) echo "task-index markdown false" ;;
        tests.md) echo "tests markdown false" ;;
        test-report.md) echo "test-report markdown false" ;;
        smoke-report.md) echo "smoke-report markdown false" ;;
        review.md) echo "review markdown true" ;;
        feedback.md) echo "feedback markdown false" ;;
        develop-log.md) echo "develop-log markdown false" ;;
        tasks/T-*.done.md) echo "done markdown false" ;;
        tasks/T-*.test-log.txt) echo "test-log text false" ;;
        tasks/T-*.md) echo "task markdown false" ;;
        *.json) echo "json json false" ;;
        *.yaml|*.yml) echo "yaml yaml false" ;;
        *.html) echo "html iframe false" ;;
        *.md) echo "markdown markdown false" ;;
        *) echo "other text false" ;;
    esac
}

refresh_artifacts() {
    if [ "$#" -ne 1 ]; then
        echo "refresh_artifacts: expected project" >&2
        return 2
    fi
    local project="$1"
    local root="${LOOM_ROOT:-.loom}"
    local dir="$root/$project"
    local out="$dir/artifacts.json"
    [ -d "$dir" ] || return 1

    local tmp
    tmp="$(mktemp)"
    while IFS= read -r -d '' file; do
        local rel meta kind renderer primary
        rel="${file#"$dir"/}"
        case "$rel" in
            artifacts.json|events.jsonl|.lock/*|.locks/*|.in-flight/*|*.tmp.*) continue ;;
        esac
        read -r kind renderer primary <<< "$(_kind_for_path "$rel")"
        jq -cn --arg path "$rel" --arg kind "$kind" --arg renderer "$renderer" --argjson primary "$primary" \
            '{path:$path,kind:$kind,renderer:$renderer,primary:$primary}' >> "$tmp"
    done < <(find "$dir" -type f -print0 | LC_ALL=C sort -z)

    local ts artifacts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    artifacts="$(jq -s '.' "$tmp")"
    rm -f "$tmp"
    atomic_write "$out" "$(jq -n --arg updated "$ts" --argjson artifacts "$artifacts" '{"schema-version":1,"updated-at":$updated,artifacts:$artifacts}')"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    refresh_artifacts "$@"
fi
