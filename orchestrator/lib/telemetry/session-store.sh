#!/usr/bin/env bash
# Session-ownership store helpers. Source-only; callers set their own shell options.
# Pure bash + POSIX utilities (mkdir, mv, cat, printf); no jq, no python3.
# Atomicity comes from `mv` over a sibling tmp file, not from locking.

session_store_path() {
    local loom_root="$1"
    local session_id="$2"
    printf '%s/.sessions/%s.txt' "$loom_root" "$session_id"
}

session_store_write() {
    local loom_root="$1"
    local session_id="$2"
    local project="$3"
    local target tmp
    target="$(session_store_path "$loom_root" "$session_id")"
    mkdir -p "$loom_root/.sessions"
    tmp="$target.tmp.${BASHPID:-$$}.${RANDOM}"
    printf '%s\n' "$project" > "$tmp"
    mv -f "$tmp" "$target"
}

session_store_read() {
    local loom_root="$1"
    local session_id="$2"
    local target
    target="$(session_store_path "$loom_root" "$session_id")"
    [ -f "$target" ] || return 0
    local content
    content="$(cat "$target")"
    # Trim leading/trailing whitespace including the trailing newline.
    content="${content#"${content%%[![:space:]]*}"}"
    content="${content%"${content##*[![:space:]]}"}"
    printf '%s' "$content"
}

session_store_owned_by_other() {
    local loom_root="$1"
    local session_id="$2"
    local project="$3"
    local sessions_dir="$loom_root/.sessions"
    [ -d "$sessions_dir" ] || return 1
    local self_file="$sessions_dir/$session_id.txt"
    local file other_id other_project
    shopt -s nullglob
    for file in "$sessions_dir"/*.txt; do
        [ "$file" = "$self_file" ] && continue
        other_id="${file##*/}"
        other_id="${other_id%.txt}"
        other_project="$(session_store_read "$loom_root" "$other_id")"
        if [ "$other_project" = "$project" ]; then
            shopt -u nullglob
            return 0
        fi
    done
    shopt -u nullglob
    return 1
}

session_store_list_owned() {
    local loom_root="$1"
    local sessions_dir="$loom_root/.sessions"
    [ -d "$sessions_dir" ] || return 0
    local file session_id project
    shopt -s nullglob
    for file in "$sessions_dir"/*.txt; do
        session_id="${file##*/}"
        session_id="${session_id%.txt}"
        project="$(session_store_read "$loom_root" "$session_id")"
        printf '%s\t%s\n' "$session_id" "$project"
    done
    shopt -u nullglob
}
