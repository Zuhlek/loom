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

# The holder PID we record is `$PPID` — the process that invoked
# `bash locks.sh ...`, not the ephemeral subshell that runs locks.sh
# itself. `$$` would die the moment this script returns, making any
# subsequent `release` call see a fresh `$$` that never matches the
# acquired one. `$PPID` is the calling agent / shell, which is stable
# across a session's repeated acquire/release calls.
_holder_pid() {
    printf '%s' "${LOOM_HOLDER_PID:-$PPID}"
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
    local ts holder
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    holder="$(_holder_pid)"
    jq -cn \
        --argjson pid "$holder" \
        --arg host "$(hostname)" \
        --arg started "$ts" \
        --arg label "$label" \
        '{"schema-version":1,pid:$pid,host:$host,"started-at":$started,label:(if $label == "" then null else $label end)}' \
        > "$lock/info.json"
}

_release() {
    local lock="$1"
    [ -d "$lock" ] || return 0
    local pid host holder
    pid="$(jq -r '.pid // empty' "$lock/info.json" 2>/dev/null || true)"
    host="$(jq -r '.host // empty' "$lock/info.json" 2>/dev/null || true)"
    holder="$(_holder_pid)"
    # Allow release when the recorded holder matches us, OR the holder
    # is gone (stale lock cleanup) on the same host. Refuse only when a
    # live different holder owns the lock on the same host.
    if [ "$host" = "$(hostname)" ]; then
        if [ "$pid" = "$holder" ] || ! _pid_alive "$pid"; then
            rm -rf "$lock"
            return 0
        fi
        return 1
    fi
    # Cross-host: refuse — releasing a lock held on a different host
    # would be a coordination bug.
    return 1
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
