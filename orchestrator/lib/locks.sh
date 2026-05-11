#!/usr/bin/env bash
set -euo pipefail

_lock_dir() {
    printf '%s/%s/.lock' "${LOOM_ROOT:-.loom}" "$1"
}

_task_lock_dir() {
    printf '%s/%s/.locks/%s.lock' "${LOOM_ROOT:-.loom}" "$1" "$2"
}

_pid_alive() {
    [ -n "${1:-}" ] && ps -p "$1" >/dev/null 2>&1
}

_acquire() {
    local lock="$1"
    local label="$2"
    mkdir -p "$(dirname "$lock")"

    if [ -f "$lock/info.json" ]; then
        local pid host
        pid="$(jq -r '.pid // empty' "$lock/info.json" 2>/dev/null || true)"
        host="$(jq -r '.host // empty' "$lock/info.json" 2>/dev/null || true)"
        if [ "$host" = "$(hostname)" ] && ! _pid_alive "$pid"; then
            rm -rf "$lock"
        fi
    fi

    mkdir "$lock" 2>/dev/null || return 1
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq -cn \
        --argjson pid "$$" \
        --arg host "$(hostname)" \
        --arg started "$ts" \
        --arg label "$label" \
        '{"schema-version":1,pid:$pid,host:$host,"started-at":$started,label:(if $label == "" then null else $label end)}' \
        > "$lock/info.json"
}

_release() {
    local lock="$1"
    [ -d "$lock" ] || return 0
    local pid host
    pid="$(jq -r '.pid // empty' "$lock/info.json" 2>/dev/null || true)"
    host="$(jq -r '.host // empty' "$lock/info.json" 2>/dev/null || true)"
    [ "$pid" = "$$" ] && [ "$host" = "$(hostname)" ] || return 1
    rm -rf "$lock"
}

acquire_lock() {
    local project="${1:?project required}"
    local phase="${2:-}"
    _acquire "$(_lock_dir "$project")" "$phase"
}

release_lock() {
    local project="${1:?project required}"
    _release "$(_lock_dir "$project")"
}

lock_info() {
    local project="${1:?project required}"
    local lock
    lock="$(_lock_dir "$project")"
    [ -f "$lock/info.json" ] && cat "$lock/info.json"
}

acquire_task_lock() {
    local project="${1:?project required}"
    local task_id="${2:?task id required}"
    _acquire "$(_task_lock_dir "$project" "$task_id")" "$task_id"
}

release_task_lock() {
    local project="${1:?project required}"
    local task_id="${2:?task id required}"
    _release "$(_task_lock_dir "$project" "$task_id")"
}

task_lock_info() {
    local project="${1:?project required}"
    local task_id="${2:?task id required}"
    local lock
    lock="$(_task_lock_dir "$project" "$task_id")"
    [ -f "$lock/info.json" ] && cat "$lock/info.json"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    cmd="${1:-}"
    shift || true
    case "$cmd" in
        acquire) acquire_lock "$@" ;;
        release) release_lock "$@" ;;
        info) lock_info "$@" ;;
        acquire-task) acquire_task_lock "$@" ;;
        release-task) release_task_lock "$@" ;;
        task-info) task_lock_info "$@" ;;
        *) echo "locks.sh: expected acquire|release|info|acquire-task|release-task|task-info" >&2; exit 2 ;;
    esac
fi
