#!/usr/bin/env bash

# Idempotent installer for the loom skills and the /weave hook wiring.
#
# Behaviour: sweep + recreate.
#   1. Scrub any symlink in ~/.claude/skills/ whose target points inside
#      this loom orchestrator directory (catches stale entries from
#      prior installs, e.g. renamed or removed skills).
#   2. Symlink every subdirectory of orchestrator/ that contains a
#      SKILL.md into ~/.claude/skills/. The types/ directory is also
#      symlinked (shared knowledge, no SKILL.md by design).
#   3. Symlink ~/.claude/loom-hooks -> orchestrator/hooks and merge the
#      loom hook wiring into ~/.claude/settings.json. Pre-existing
#      loom-hooks entries are scrubbed before merge so re-runs converge
#      on one entry. Entries from other packages (e.g. forge-hooks) are
#      left alone.
#
# Re-running on a clean or already-set-up machine produces the same end
# state. Non-symlinks in ~/.claude/skills/ are never clobbered.
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

# Canonical loom hook wiring. Single source of truth — piped into jq via
# `--argjson loom`, and printed to stderr as the no-jq fallback. `$ROOT`
# is substituted at runtime so subagent transcripts get tagged against
# the real install path.
LOOM_HOOKS_JSON="$(cat <<JSON
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "\"\$HOME/.claude/loom-hooks/resume-on-start.sh\"" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "\"\$HOME/.claude/loom-hooks/validate-subagent-output.sh\"" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "\"\$HOME/.claude/loom-hooks/auto-advance.sh\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "\"\$HOME/.claude/loom-hooks/refresh-artifacts.sh\"" }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          { "type": "command", "command": "python3 \"$ROOT/lib/telemetry/tag-subagent-phase.py\"" }
        ]
      }
    ]
  }
}
JSON
)"

# -----------------------------------------------------------------------------
# 1. Sweep — remove any symlink in ~/.claude/skills/ whose target is inside
#    this loom orchestrator dir. Catches renamed / removed / stale entries
#    from prior installs of THIS package. Symlinks from other packages are
#    left alone (they point elsewhere).
# -----------------------------------------------------------------------------
swept=0
for entry in "$SKILLS_DIR"/*; do
    [ -L "$entry" ] || continue
    target="$(readlink "$entry")"
    case "$target" in
        "$ROOT"/*|"$ROOT")
            rm "$entry"
            echo "scrubbed   $entry"
            swept=$((swept + 1))
            ;;
    esac
done
[ "$swept" -gt 0 ] && echo ""

# -----------------------------------------------------------------------------
# 2. Recreate skill symlinks — every subdir with a SKILL.md, plus types/.
# -----------------------------------------------------------------------------
link_dir() {
    local source="$1"
    local name
    name="$(basename "$source")"
    local link="$SKILLS_DIR/$name"
    if [ -e "$link" ] && [ ! -L "$link" ]; then
        echo "skip       $link: exists and is not a symlink (refusing to clobber)" >&2
        return 0
    fi
    ln -s "$source" "$link"
    echo "linked     $link -> $source"
}

for sub in "$ROOT"/*/; do
    [ -d "$sub" ] || continue
    name="$(basename "$sub")"
    if [ -f "$sub/SKILL.md" ] || [ "$name" = "types" ]; then
        link_dir "${sub%/}"
    fi
done

# -----------------------------------------------------------------------------
# 3. Hook wiring — ~/.claude/loom-hooks symlink + settings.json merge of
#    the loom hook entries.
# -----------------------------------------------------------------------------
echo ""
if [ -L "$HOOKS_LINK" ]; then
    current="$(readlink "$HOOKS_LINK")"
    if [ "$current" = "$ROOT/hooks" ]; then
        echo "ok         $HOOKS_LINK -> $ROOT/hooks"
    else
        rm "$HOOKS_LINK"
        ln -s "$ROOT/hooks" "$HOOKS_LINK"
        echo "linked     $HOOKS_LINK -> $ROOT/hooks"
    fi
elif [ -e "$HOOKS_LINK" ]; then
    echo "skip       $HOOKS_LINK: exists and is not a symlink (refusing to clobber)" >&2
else
    ln -s "$ROOT/hooks" "$HOOKS_LINK"
    echo "linked     $HOOKS_LINK -> $ROOT/hooks"
fi

if [ ! -f "$SETTINGS" ]; then
    printf '{\n  "$schema": "https://json.schemastore.org/claude-code-settings.json"\n}\n' > "$SETTINGS"
    echo "created    $SETTINGS"
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "warn       jq not found; copy the following hook settings manually into $SETTINGS:" >&2
    printf '%s\n' "$LOOM_HOOKS_JSON" >&2
    exit 0
fi

tmp="$SETTINGS.tmp.$$"
trap 'rm -f "$tmp"' EXIT

jq --argjson loom "$LOOM_HOOKS_JSON" '
  def is_legacy_loom_hook($entry):
    ($entry.hooks // [])
    | any(.command? // "" | test("loom/hooks/|orchestrator/hooks/|/loom-hooks/"));

  def scrub_event($event):
    (.hooks[$event] // [])
    | map(select(is_legacy_loom_hook(.) | not));

  def merge_event($event):
    (scrub_event($event)) + (($loom.hooks[$event]) // []);

  .hooks = (.hooks // {})
    | .hooks.SessionStart = merge_event("SessionStart")
    | .hooks.SubagentStop = merge_event("SubagentStop")
    | .hooks.Stop         = merge_event("Stop")
    | .hooks.PreToolUse   = merge_event("PreToolUse")
    | .hooks.PostToolUse  = merge_event("PostToolUse")
' "$SETTINGS" > "$tmp"

mv "$tmp" "$SETTINGS"
echo "updated    $SETTINGS"

missing=0
while IFS= read -r cmd; do
    resolved="${cmd//\"/}"
    resolved="${resolved/\$HOME/$HOME}"
    if [ ! -x "$resolved" ]; then
        echo "warn       hook command not executable: $resolved" >&2
        missing=$((missing + 1))
    fi
done < <(jq -r '.hooks // {} | to_entries[].value[].hooks[]?.command? | select(. != null) | select(test("loom-hooks"))' "$SETTINGS")

if [ "$missing" -gt 0 ]; then
    echo "warn       $missing hook command(s) did not resolve; investigate before relying on hooks" >&2
    exit 1
fi

echo "done       loom hook wiring resolves cleanly"
