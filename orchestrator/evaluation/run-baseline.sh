#!/usr/bin/env bash
# run-baseline — drive N /weave runs against a fixed seed + canned answer
# queue. Each iteration creates `.loom/<project>/`, /weave fills it (and
# writes `.eval-orchestrator-pointer` linking to its Claude session).
# Harvest and aggregation happen later, in `analyze.py` (npm: eval:analyse),
# when you point it at the filed run under `analytics/<version>/<run>/`.
#
# Usage:
#   orchestrator/evaluation/run-baseline.sh [--n N] [--seed PATH] [--answers PATH]
#
# Defaults:
#   N=5
#   seed    = orchestrator/evaluation/baseline-seed.md (vendored copy)
#   answers = orchestrator/evaluation/baseline-answers.yaml
#
# `set -e` is intentionally OMITTED so a single iteration failure does
# not abort the loop.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

N=5
SEED="$SCRIPT_DIR/baseline-seed.md"
ANSWERS="$SCRIPT_DIR/baseline-answers.yaml"

usage() {
    cat <<EOF >&2
Usage: $(basename "$0") [--n N] [--seed PATH] [--answers PATH]

  --n N            number of iterations (default: 5)
  --seed PATH      seed file copied into each workspace (default: vendored)
  --answers PATH   canned answer queue for /weave --answers (default: vendored)
  -h, --help       show this help
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --n)         N="${2:?--n requires a value}"; shift 2 ;;
        --n=*)       N="${1#--n=}"; shift ;;
        --seed)      SEED="${2:?--seed requires a value}"; shift 2 ;;
        --seed=*)    SEED="${1#--seed=}"; shift ;;
        --answers)   ANSWERS="${2:?--answers requires a value}"; shift 2 ;;
        --answers=*) ANSWERS="${1#--answers=}"; shift ;;
        -h|--help)   usage; exit 0 ;;
        *) echo "[run-baseline] unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

if ! [ "$N" -eq "$N" ] 2>/dev/null; then
    echo "[run-baseline] --n must be an integer; got '$N'" >&2; exit 2
fi
if [ "$N" -lt 1 ]; then
    echo "[run-baseline] --n must be >= 1" >&2; exit 2
fi
if [ ! -f "$SEED" ];    then echo "[run-baseline] seed not found: $SEED" >&2; exit 2; fi
if [ ! -f "$ANSWERS" ]; then echo "[run-baseline] answers not found: $ANSWERS" >&2; exit 2; fi
if ! command -v claude >/dev/null 2>&1; then
    echo "[run-baseline] 'claude' CLI not on PATH; cannot dispatch /weave." >&2; exit 2
fi

cd "$REPO_ROOT"
mkdir -p .loom

failures=0
ts="$(date -u +%s)"
for i in $(seq 1 "$N"); do
    project="baseline-${ts}-${i}"
    workspace=".loom/$project"
    mkdir -p "$workspace"
    cp "$SEED" "$workspace/seed.md"
    echo "[run-baseline] iteration $i / $N — project $project" >&2
    if ! claude --print "/weave $project --answers $ANSWERS"; then
        echo "[run-baseline] iteration $i failed; continuing" >&2
        failures=$((failures + 1))
    fi
done

echo "[run-baseline] done: $N iteration(s), $failures failed" >&2
exit 0
