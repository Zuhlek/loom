#!/usr/bin/env bash
# Capture hook shim. Execs the Python sibling that reads the Task transcript
# from stdin (Claude Code SubagentStop payload) and appends one row to
# `.loom/<project>/usage.jsonl`.
#
# The shim mirrors `validate-subagent-output.sh`'s shape on purpose: a single
# `exec python3 <sibling>.py`. It returns 0 unconditionally so a logging bug
# never affects run flow (the hook is read-only with respect to the user's
# work).
set -u  # NOT -e: we want to swallow Python failures and still return 0.
_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$_HOOK_DIR/capture-subagent-eval.py" || true
exit 0
