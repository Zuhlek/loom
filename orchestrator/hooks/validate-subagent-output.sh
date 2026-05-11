#!/usr/bin/env bash
set -euo pipefail

_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$_HOOK_DIR/validate-subagent-output.py"
