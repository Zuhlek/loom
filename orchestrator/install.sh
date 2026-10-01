#!/usr/bin/env bash
# Link ~/.claude/skills/weave to this repo's orchestrator/weave.
# Windows Git Bash: ln -s silently copies, so use a junction there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
LINK="$SKILLS_DIR/weave"
TARGET="$ROOT/weave"

mkdir -p "$SKILLS_DIR"

if [ -e "$LINK" ]; then
    echo "removing existing $LINK"
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            # Delete a junction without following it into the target;
            # fall back to a recursive delete for a real directory.
            powershell.exe -NoProfile -Command \
                "\$p = '$(cygpath -w "$LINK")'; \$i = Get-Item \$p -Force; if (\$i.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete(\$p) } else { Remove-Item \$p -Recurse -Force }"
            ;;
        *)
            rm -rf "$LINK"
            ;;
    esac
fi

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        # cmd/mklink quoting is unreliable from Git Bash; PowerShell is not.
        powershell.exe -NoProfile -Command \
            "New-Item -ItemType Junction -Path '$(cygpath -w "$LINK")' -Target '$(cygpath -w "$TARGET")' | Out-Null"
        ;;
    *)
        ln -s "$TARGET" "$LINK"
        ;;
esac

[ -f "$LINK/SKILL.md" ] || { echo "install failed: $LINK/SKILL.md not reachable" >&2; exit 1; }
echo "ok  $LINK -> $TARGET"
