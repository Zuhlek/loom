#!/bin/bash

# Setup forge skills: symlink /idea, /build, /forge, and types/ into ~/.claude/skills/
# and create the shared personal develop-log file (gitignored).
# Author: Artur Melo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL_SKILLS_DIR="$HOME/.claude/skills"

mkdir -p "$GLOBAL_SKILLS_DIR"

# Symlink each skill directory
for skill_dir in "$SCRIPT_DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    link="$GLOBAL_SKILLS_DIR/$skill_name"

    if [ -L "$link" ]; then
        rm "$link"
    elif [ -e "$link" ]; then
        echo "Warning: $link exists and is not a symlink. Skipping."
        continue
    fi

    ln -sf "$skill_dir" "$link"
    echo "Linked: $link -> $skill_dir"
done

# Symlink the README
if [ -f "$SCRIPT_DIR/README.md" ]; then
    ln -sf "$SCRIPT_DIR/README.md" "$GLOBAL_SKILLS_DIR/README.md"
    echo "Linked: $GLOBAL_SKILLS_DIR/README.md"
fi

# Symlink the shared develop-log
log="$SCRIPT_DIR/develop-log.md"
if [ ! -f "$log" ]; then
    cat > "$log" << EOF
# Forge Development Log

Unified observations from /idea and /build sessions. Curated by /forge review.

---
EOF
    echo "Created: $log"
fi
ln -sf "$log" "$GLOBAL_SKILLS_DIR/develop-log.md"
echo "Linked: $GLOBAL_SKILLS_DIR/develop-log.md"

# Clean up legacy per-skill develop-logs (from pre-unified setup)
for skill in idea build; do
    old_log="$SCRIPT_DIR/$skill/develop-log.md"
    if [ -f "$old_log" ] && [ ! -L "$old_log" ]; then
        echo "Note: Legacy log found at $old_log — consider merging into $log"
    fi
done

echo ""
echo "  The Forge is lit. The anvil stands ready."
echo ""
echo "  /idea   — from the deep mines, shape the raw ore of thought"
echo "  /build  — through fire and hammer, temper it into steel"
echo "  /forge  — the master's eye, finding what the hammer missed"
echo ""
echo "  What is forged here will not be forgotten."
