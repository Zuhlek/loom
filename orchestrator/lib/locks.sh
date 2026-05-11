#!/usr/bin/env bash
set -euo pipefail

_lock_dir() {
    printf '%s/%s/.lock' "${LOOM_ROOT:-.loom}" "$1"
}

_pid_alive() {
    [ -n "${1:-}" ] && ps -p "$1" >/dev/null 2>&1
}

acquire_lock() {
    local project="${1:?project required}"
    local phase="${2:-}"
    local lock
    lock="$(_lock_dir "$project")"
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
        --arg phase "$phase" \
        '{"schema-version":1,pid:$pid,host:$host,"started-at":$started,phase:(if $phase == "" then null else $phase end)}' \
        > "$lock/info.json"
}

release_lock() {
    local project="${1:?project required}"
    local lock
    lock="$(_lock_dir "$project")"
    [ -d "$lock" ] || return 0
    local pid host
    pid="$(jq -r '.pid // empty' "$lock/info.json" 2>/dev/null || true)"
    host="$(jq -r '.host // empty' "$lock/info.json" 2>/dev/null || true)"
    [ "$pid" = "$$" ] && [ "$host" = "$(hostname)" ] || return 1
    rm -rf "$lock"
}

lock_info() {
    local project="${1:?project required}"
    local lock
    lock="$(_lock_dir "$project")"
    [ -f "$lock/info.json" ] && cat "$lock/info.json"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    cmd="${1:-}"
    shift || true
    case "$cmd" in
        acquire) acquire_lock "$@" ;;
        release) release_lock "$@" ;;
        info) lock_info "$@" ;;
        *) echo "locks.sh: expected acquire|release|info" >&2; exit 2 ;;
    esac
fi
