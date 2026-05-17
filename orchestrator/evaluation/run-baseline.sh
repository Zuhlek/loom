#!/usr/bin/env bash
# run-baseline — drive N /weave runs against a fixed seed + canned answer
# queue. Each iteration creates `.loom/<project>/`, then invokes /weave
# under `claude --print` until `pipeline.md.Lifecycle state == complete`.
# Each /weave invocation runs one phase, pauses at the rerun-or-continue
# gate (AskUserQuestion cancels with no interactive UI), and exits; the
# next invocation resumes from the paused phase. The orchestrator records
# its session pointer via `.eval-orchestrator-pointer` for later harvest.
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

PARSER="$REPO_ROOT/orchestrator/lib/pipeline-parser.py"
# Per-iteration cap on /weave re-invocations. The orchestrator pauses on
# every rerun-or-continue gate under `claude --print`; each pause needs
# one resume invocation. Five phases × occasional schema-recovery dispatch
# tolerated → ten resumes is the safety ceiling.
MAX_RESUMES=10

failures=0
ts="$(date -u +%s)"
for i in $(seq 1 "$N"); do
    project="baseline-${ts}-${i}"
    workspace=".loom/$project"
    pipeline="$workspace/pipeline.md"
    mkdir -p "$workspace"
    cp "$SEED" "$workspace/seed.md"
    echo "[run-baseline] iteration $i / $N — project $project" >&2

    resume=0
    iteration_failed=0
    while : ; do
        resume=$((resume + 1))
        if [ "$resume" -gt "$MAX_RESUMES" ]; then
            echo "[run-baseline] iteration $i exceeded $MAX_RESUMES resumes; aborting" >&2
            iteration_failed=1
            break
        fi
        echo "[run-baseline]   resume $resume — /weave $project" >&2
        if ! claude --print "/weave $project --answers $ANSWERS"; then
            echo "[run-baseline] iteration $i resume $resume returned non-zero; aborting iteration" >&2
            iteration_failed=1
            break
        fi
        if [ ! -f "$pipeline" ]; then
            echo "[run-baseline] iteration $i: pipeline.md missing after resume $resume; aborting iteration" >&2
            iteration_failed=1
            break
        fi
        lifecycle="$(python3 "$PARSER" field "$pipeline" "Lifecycle state" 2>/dev/null || echo "")"
        if [ "$lifecycle" = "complete" ]; then
            echo "[run-baseline] iteration $i complete after $resume resume(s)" >&2
            break
        fi
        echo "[run-baseline]   lifecycle still '$lifecycle' — re-invoking" >&2
    done
    if [ "$iteration_failed" -eq 1 ]; then
        failures=$((failures + 1))
    fi
done

echo "[run-baseline] done: $N iteration(s), $failures failed" >&2
exit 0
