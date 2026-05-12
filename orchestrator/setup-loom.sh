#!/usr/bin/env bash
# Idempotent installer for loom's Claude Code integration.
#
# Creates four symlinks under ~/.claude/ so Claude Code can find:
#   - the three skill directories (weave, tune, log)
#   - the hook scripts (loom-hooks)
#
# Then merges loom's hook wiring into ~/.claude/settings.json. Any
# pre-existing entries pointing at the legacy `loom/hooks/` path (or
# at `orchestrator/hooks/` directly without the symlink) are removed
# before the new entries are merged, so re-running cleans up drift.
#
# Usage:
#   bash orchestrator/setup-loom.sh
#
# Override targets via env vars:
#   CLAUDE_SKILLS_DIR (default ~/.claude/skills)
#   CLAUDE_HOOKS_LINK (default ~/.claude/loom-hooks)
#   CLAUDE_SETTINGS   (default ~/.claude/settings.json)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
HOOKS_LINK="${CLAUDE_HOOKS_LINK:-$HOME/.claude/loom-hooks}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

mkdir -p "$SKILLS_DIR"
mkdir -p "$(dirname "$HOOKS_LINK")"
mkdir -p "$(dirname "$SETTINGS")"

# Make + verify one symlink. Replaces an existing symlink only if it
# points somewhere else; refuses to clobber a non-symlink.
make_link() {
    local link="$1"
    local target="$2"
    if [ -L "$link" ]; then
        local current
        current="$(readlink "$link")"
        if [ "$current" = "$target" ]; then
            echo "ok      $link -> $target"
            return 0
        fi
        rm "$link"
    elif [ -e "$link" ]; then
        echo "skip    $link: exists and is not a symlink (refusing to clobber)" >&2
        return 0
    fi
    ln -s "$target" "$link"
    echo "linked  $link -> $target"
}

# Symlinks (in this order):
#   ~/.claude/skills/weave  -> orchestrator/weave  (the /weave skill)
#   ~/.claude/skills/tune   -> orchestrator/tune   (the /tune skill)
#   ~/.claude/skills/log    -> orchestrator/log    (curation source read by /tune)
#   ~/.claude/loom-hooks    -> orchestrator/hooks  (settings.json points here)
make_link "$SKILLS_DIR/weave" "$ROOT/weave"
make_link "$SKILLS_DIR/tune"  "$ROOT/tune"
make_link "$SKILLS_DIR/log"   "$ROOT/log"
make_link "$HOOKS_LINK"       "$ROOT/hooks"

# Bootstrap an empty settings.json if absent.
if [ ! -f "$SETTINGS" ]; then
    printf '{\n  "$schema": "https://json.schemastore.org/claude-code-settings.json"\n}\n' > "$SETTINGS"
    echo "created $SETTINGS"
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "jq not found; manually copy hook settings from $ROOT/hooks/settings.example.json into $SETTINGS" >&2
    exit 0
fi

# Merge loom's hook entries into the user's settings.
#
# Strategy:
#   1. Scrub legacy entries — any hook command containing loom-owned
#      hook scripts under one of the deprecated path prefixes
#      (`loom/hooks/` or `orchestrator/hooks/`). This is the migration
#      path for users who installed an earlier broken version.
#   2. Merge in the canonical entries from settings.example.json,
#      which now use `$HOME/.claude/loom-hooks/<hook>.sh`.
#
# Per-event hook arrays are merged additively: existing non-loom
# entries are preserved.

tmp="$SETTINGS.tmp.$$"
trap 'rm -f "$tmp"' EXIT

jq --slurpfile loom "$ROOT/hooks/settings.example.json" '
  def is_legacy_loom_hook($entry):
    ($entry.hooks // [])
    | any(.command? // "" | test("loom/hooks/|orchestrator/hooks/|/loom-hooks/"));

  def scrub_event($event):
    (.hooks[$event] // [])
    | map(select(is_legacy_loom_hook(.) | not));

  def merge_event($event):
    (scrub_event($event)) + (($loom[0].hooks[$event]) // []);

  .hooks = (.hooks // {})
    | .hooks.SessionStart = merge_event("SessionStart")
    | .hooks.SubagentStop = merge_event("SubagentStop")
    | .hooks.Stop         = merge_event("Stop")
    | .hooks.PreToolUse   = merge_event("PreToolUse")
    | .hooks.PostToolUse  = merge_event("PostToolUse")
' "$SETTINGS" > "$tmp"

mv "$tmp" "$SETTINGS"
echo "updated $SETTINGS"

# Sanity check — every loom hook command should now resolve.
missing=0
while IFS= read -r cmd; do
    # Strip surrounding quotes and expand $HOME for the existence check.
    resolved="${cmd//\"/}"
    resolved="${resolved/\$HOME/$HOME}"
    if [ ! -x "$resolved" ]; then
        echo "warn    hook command not executable: $resolved" >&2
        missing=$((missing + 1))
    fi
done < <(jq -r '.hooks // {} | to_entries[].value[].hooks[]?.command? | select(. != null) | select(test("loom-hooks"))' "$SETTINGS")

if [ "$missing" -gt 0 ]; then
    echo "warn    $missing hook command(s) did not resolve; investigate before relying on hooks" >&2
    exit 1
fi

echo "done    loom hook wiring resolves cleanly"
