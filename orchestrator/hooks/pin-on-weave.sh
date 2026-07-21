#!/usr/bin/env bash
set -euo pipefail

# UserPromptSubmit hook: pin the firing session to the Loom project it
# explicitly engages via /weave.
#
# Ownership contract (docs/orchestrator/hooks.md § Session ownership):
# this hook is the primary writer of the session-ownership store. When
# /weave names an existing workspace (or exactly one workspace exists),
# the pin is written immediately. Anything else — ticket id, free text,
# project creation — drops a weave-intent marker instead; auto-advance.sh
# converts the marker into a pin from `.loom/.active` once the
# orchestrator has resolved the real project name. Sessions that never
# type /weave get neither file and never hear from the Loom hooks.
#
# stdout must stay empty on exit 0: UserPromptSubmit stdout is injected
# into the model's context. Diagnostics go to stderr only.

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
store_lib="$hook_dir/../lib/telemetry/session-store.sh"

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
printf '%s' "$input" | jq -e . >/dev/null 2>&1 || exit 0

session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || true)"

[ -n "$session_id" ] || exit 0
[ -n "$prompt" ] || exit 0

# The session id becomes a filename under .sessions/ — never let it
# carry path separators or traversal. Claude Code supplies UUIDs;
# anything else is refused rather than written.
case "$session_id" in
    */*|*..*|.*)
        printf 'LOOM_PIN_REJECTED_SID=1\n' >&2
        exit 0
        ;;
esac

if [ ! -f "$store_lib" ]; then
    printf 'LOOM_SESSION_STORE_MISSING=1\n' >&2
    exit 0
fi
# shellcheck disable=SC1090
source "$store_lib"

# A /weave invocation always sits at the very start of the submission, so
# only a bounded prefix ever matters. Extracting it with substring
# expansion (not a pipe) keeps megabyte pastes cheap and, critically,
# avoids the pipefail+SIGPIPE trap where a downstream `grep -q`/`head`
# closing the pipe early makes the pipeline non-zero and aborts the hook.
prefix="${prompt:0:4096}"
case "$prefix" in
    *"/weave"*) ;;
    *) exit 0 ;;
esac

# Recognise both the raw slash command ("/weave <project>") and the
# expanded command envelope some clients submit
# (<command-name>/weave</command-name> ... <command-args>...</command-args>).
# Both forms sit at the very start of the submission — a /weave merely
# quoted or pasted mid-prompt is not an invocation and must not pin.
matched=0
arg=""

trimmed="${prefix#"${prefix%%[![:space:]]*}"}"
first_line="${trimmed%%$'\n'*}"
set -f
# shellcheck disable=SC2086
set -- $first_line
set +f
if [ "${1:-}" = "/weave" ]; then
    matched=1
    arg="${2:-}"
else
    case "$trimmed" in
        "<command-"*)
            if printf '%s' "$prefix" | grep -qE '<command-name>/?weave</command-name>'; then
                matched=1
                args_body="$(printf '%s' "$prefix" | grep -oE '<command-args>[^<]*</command-args>' | head -n1 || true)"
                args_body="${args_body#<command-args>}"
                args_body="${args_body%</command-args>}"
                set -f
                # shellcheck disable=SC2086
                set -- $args_body
                set +f
                arg="${1:-}"
            fi
            ;;
    esac
fi
[ "$matched" -eq 1 ] || exit 0

resolve_loom_root() {
    local dir="$1"
    case "$dir" in
        /*) ;;
        *) return 1 ;;
    esac
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        if [ -d "$dir/.loom" ]; then
            printf '%s/.loom' "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

loom_root=""
if [ -n "$cwd" ]; then
    loom_root="$(resolve_loom_root "$cwd" || true)"
fi
[ -n "$loom_root" ] || loom_root="${LOOM_ROOT:-}"
if [ -z "$loom_root" ]; then
    # No workspace root anywhere: the creation flow. /weave itself will
    # create .loom/<project> under cwd; the intent marker goes there.
    # A bare /weave with no root has nothing to engage.
    [ -n "$arg" ] && [ -n "$cwd" ] || exit 0
    loom_root="$cwd/.loom"
fi

# A failed write (unwritable cwd, .loom occupied by a file, …) must not
# surface as a hook error — the session simply stays unpinned.
mark_intent() {
    if ! mkdir -p "$loom_root/.sessions" 2>/dev/null \
        || ! : > "$loom_root/.sessions/$session_id.weave-intent" 2>/dev/null; then
        printf 'LOOM_PIN_WRITE_FAILED=1\n' >&2
    fi
    exit 0
}

project=""
if [ -n "$arg" ]; then
    case "$arg" in
        */*|.*|-*)
            printf 'LOOM_PIN_REJECTED_ARG=%s\n' "$arg" >&2
            exit 0
            ;;
    esac
    # Only an exact match on an existing workspace pins immediately.
    # Ticket ids, free text, and to-be-created projects resolve to a
    # derived name only the orchestrator knows — record intent instead.
    [ -d "$loom_root/$arg" ] || mark_intent
    project="$arg"
else
    # Bare /weave: pin only when the target is unambiguous — exactly one
    # workspace with a pipeline.md. Otherwise record intent; the
    # orchestrator resolves the project with the user and auto-advance
    # adopts it from .loom/.active.
    count=0
    while IFS= read -r -d '' pipeline; do
        count=$((count + 1))
        project="$(basename "$(dirname "$pipeline")")"
    done < <(find "$loom_root" -maxdepth 2 -name pipeline.md -type f -print0 2>/dev/null)
    [ "$count" -eq 1 ] || mark_intent
fi

if ! session_store_write "$loom_root" "$session_id" "$project" 2>/dev/null; then
    printf 'LOOM_PIN_WRITE_FAILED=1\n' >&2
fi
exit 0
