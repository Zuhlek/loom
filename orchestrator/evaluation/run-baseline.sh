#!/usr/bin/env bash
# run-baseline — drive N /weave runs against a fixed seed + canned answer
# queue. Each iteration creates `.loom/<project>/` and invokes /weave once
# under `claude --print --append-system-prompt "$AUTONOMY_PROMPT"`. The
# autonomy directive tells the orchestrator to advance through every
# rerun-or-continue gate without prompting, so one invocation drives the
# full lifecycle to `Lifecycle state == complete`. A bounded re-invoke
# loop stays as a safety net for the rare case where /weave returns
# before completion. The orchestrator records its session pointer via
# `.eval-orchestrator-pointer` for later harvest. Harvest and aggregation
# happen later, in `analyze.py` (npm: eval:analyse), when you point it at
# the filed run under `analytics/<version>/<run>/`.
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
  --answers PATH   canned answer queue staged into .loom/<project>/.answers.yaml (default: vendored)
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

PARSER="$REPO_ROOT/orchestrator/weave/lib/pipeline-parser.py"
# Per-iteration safety cap. With the autonomy directive one /weave call
# drives the full lifecycle; this only bounds the rare case where it
# returns before reaching `Lifecycle state == complete`.
MAX_ATTEMPTS=5

# Injected via `claude --append-system-prompt` so the orchestrator drives
# the lifecycle to completion without blocking on the rerun-or-continue
# AskUserQuestion. Lives in the harness, not in SKILL.md, so interactive
# /weave keeps its gates.
AUTONOMY_PROMPT='Goal: autonomously drive the entire /weave run to completion in this single invocation. Non-interactive eval mode: never block on the rerun-or-continue AskUserQuestion at any phase gate, including the Review final gate; select the Continue option and advance. Never invoke Run quality check (opt-in only). Never invoke Go back to <prior-phase>. Drive the lifecycle until pipeline.md.Lifecycle state == complete and then exit.'

failures=0
ts="$(date -u +%s)"
for i in $(seq 1 "$N"); do
    project="baseline-${ts}-${i}"
    workspace=".loom/$project"
    pipeline="$workspace/pipeline.md"
    mkdir -p "$workspace"
    cp "$SEED" "$workspace/seed.md"
    # Validate and stage the answer queue under .loom/<project>/.answers.yaml.
    # The orchestrator no longer accepts `--answers`; the Spec grilling agent
    # reads the staged file if present.
    if ! python3 "$REPO_ROOT/orchestrator/evaluation/answer-queue.py" validate "$ANSWERS" >/dev/null 2>&1; then
        echo "[run-baseline] iteration $i: invalid answer queue $ANSWERS; aborting iteration" >&2
        failures=$((failures + 1))
        continue
    fi
    cp "$ANSWERS" "$workspace/.answers.yaml"
    echo "[run-baseline] iteration $i / $N — project $project — /weave driving lifecycle" >&2

    attempt=0
    iteration_failed=0
    while : ; do
        attempt=$((attempt + 1))
        if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
            echo "[run-baseline] iteration $i aborted after $MAX_ATTEMPTS attempts without reaching Lifecycle complete" >&2
            iteration_failed=1
            break
        fi
        if [ "$attempt" -gt 1 ]; then
            echo "[run-baseline]   retry $((attempt - 1)) — /weave returned before Lifecycle complete; re-invoking" >&2
        fi
        if ! claude --print --append-system-prompt "$AUTONOMY_PROMPT" "/weave $project"; then
            echo "[run-baseline] iteration $i: /weave returned non-zero on attempt $attempt; aborting iteration" >&2
            iteration_failed=1
            break
        fi
        if [ ! -f "$pipeline" ]; then
            echo "[run-baseline] iteration $i: pipeline.md missing after attempt $attempt; aborting iteration" >&2
            iteration_failed=1
            break
        fi
        lifecycle="$(python3 "$PARSER" field "$pipeline" "Lifecycle state" 2>/dev/null || echo "")"
        if [ "$lifecycle" = "complete" ]; then
            if [ "$attempt" -eq 1 ]; then
                echo "[run-baseline] iteration $i complete" >&2
            else
                echo "[run-baseline] iteration $i complete after $attempt attempt(s)" >&2
            fi
            break
        fi
    done
    if [ "$iteration_failed" -eq 1 ]; then
        failures=$((failures + 1))
    fi
done

echo "[run-baseline] done: $N iteration(s), $failures failed" >&2
exit 0
