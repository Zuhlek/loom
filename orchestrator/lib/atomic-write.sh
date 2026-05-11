#!/usr/bin/env bash
set -euo pipefail

atomic_write() {
    if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
        echo "atomic_write: expected 1 or 2 args" >&2
        return 2
    fi

    local path="$1"
    local dir tmp
    dir="$(dirname "$path")"
    mkdir -p "$dir"
    tmp="$path.tmp.${BASHPID:-$$}.${RANDOM}"

    trap 'rm -f "$tmp"' RETURN
    if [ "$#" -eq 2 ]; then
        printf '%s' "$2" > "$tmp"
    else
        cat > "$tmp"
    fi
    mv -f "$tmp" "$path"
    trap - RETURN
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    atomic_write "$@"
fi
