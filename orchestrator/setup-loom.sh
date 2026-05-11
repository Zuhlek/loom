#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

mkdir -p "$SKILLS_DIR"

link_skill() {
    local name="$1"
    local target="$2"
    local link="$SKILLS_DIR/$name"
    if [ -L "$link" ]; then
        current="$(readlink "$link")"
        [ "$current" = "$target" ] && return 0
        rm "$link"
    elif [ -e "$link" ]; then
        echo "skip $link: exists and is not a symlink" >&2
        return 0
    fi
    ln -s "$target" "$link"
    echo "linked $name -> $target"
}

link_skill weave "$ROOT/weave"
link_skill tune "$ROOT/tune"

mkdir -p "$(dirname "$SETTINGS")"
if [ ! -f "$SETTINGS" ]; then
    printf '{\n  "$schema": "https://json.schemastore.org/claude-code-settings.json"\n}\n' > "$SETTINGS"
fi

if command -v jq >/dev/null 2>&1; then
    tmp="$SETTINGS.tmp.$$"
    jq --slurpfile loom "$ROOT/hooks/settings.example.json" '
      .hooks = ((.hooks // {}) * ($loom[0].hooks // {}))
    ' "$SETTINGS" > "$tmp"
    mv "$tmp" "$SETTINGS"
    echo "updated $SETTINGS"
else
    echo "jq not found; copy hook settings from $ROOT/hooks/settings.example.json into $SETTINGS" >&2
fi
