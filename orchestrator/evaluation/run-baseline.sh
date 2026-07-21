#!/usr/bin/env bash
# run-baseline — drive N /weave runs against a fixed seed + canned answer
# queue, capture authoritative per-run telemetry, and (optionally) file the
# finished runs straight into analytics/<version>/.
#
# Reliability contract (v2):
#   * The Claude Code session UUID is chosen UP FRONT (--session-id) and
#     written to `.eval-orchestrator-pointer` BEFORE /weave starts, so
#     harvesting never depends on hook wiring. Retries `--resume` the same
#     session, so their subagents land in the same transcripts dir.
#   * Every attempt runs under `timeout` and with an explicit
#     `--permission-mode bypassPermissions`, so a stuck or permission-blocked
#     run cannot hang the harness and behavior does not depend on the
#     machine's ~/.claude/settings.json.
#   * The `--output-format json` result of every attempt is captured to
#     `.eval-logs/attempt-N.json` — session_id, total_cost_usd, num_turns,
#     modelUsage — and folded into `run-meta.json` together with the claude
#     CLI version, the loom git SHA, and the seed/answers hashes. Trends are
#     only comparable when those confounders match.
#   * Harvest + aggregate + outcome run IN-LOOP right after each iteration
#     (transcripts are ephemeral; harvesting at analyze time loses data).
#   * `.eval-run` marks the workspace so auto-advance in unrelated
#     interactive sessions does not hijack the run.
#
# Usage:
#   orchestrator/evaluation/run-baseline.sh [--n N] [--seed PATH] [--answers PATH]
#                                           [--version LABEL] [--model MODEL]
#                                           [--timeout-mins T] [--keep-app]
#
# Defaults:
#   N=5, timeout 90 min/attempt
#   seed    = orchestrator/evaluation/baseline-seed.md (vendored copy)
#   answers = orchestrator/evaluation/baseline-answers.yaml
#
# `set -e` is intentionally OMITTED so a single iteration failure does
# not abort the loop.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TELEMETRY="$REPO_ROOT/orchestrator/lib/telemetry"

N=5
SEED="$SCRIPT_DIR/baseline-seed.md"
ANSWERS="$SCRIPT_DIR/baseline-answers.yaml"
VERSION=""
MODEL=""
TIMEOUT_MINS=90
KEEP_APP=0

usage() {
    cat <<EOF >&2
Usage: $(basename "$0") [--n N] [--seed PATH] [--answers PATH] [--version LABEL]
                        [--model MODEL] [--timeout-mins T] [--keep-app]

  --n N             number of iterations (default: 5)
  --seed PATH       seed file copied into each workspace (default: vendored)
  --answers PATH    canned answer queue staged into .loom/<project>/.answers.yaml
  --version LABEL   file finished runs into orchestrator/evaluation/analytics/LABEL/
                    (default: leave them under .loom/ for manual filing)
  --model MODEL     pin the model for the run (recorded in run-meta.json either way)
  --timeout-mins T  per-attempt wall-clock cap (default: 90)
  --keep-app        keep .loom/<project>/app/ when filing (default: stripped, ~99MB)
  -h, --help        show this help
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --n)              N="${2:?--n requires a value}"; shift 2 ;;
        --n=*)            N="${1#--n=}"; shift ;;
        --seed)           SEED="${2:?--seed requires a value}"; shift 2 ;;
        --seed=*)         SEED="${1#--seed=}"; shift ;;
        --answers)        ANSWERS="${2:?--answers requires a value}"; shift 2 ;;
        --answers=*)      ANSWERS="${1#--answers=}"; shift ;;
        --version)        VERSION="${2:?--version requires a value}"; shift 2 ;;
        --version=*)      VERSION="${1#--version=}"; shift ;;
        --model)          MODEL="${2:?--model requires a value}"; shift 2 ;;
        --model=*)        MODEL="${1#--model=}"; shift ;;
        --timeout-mins)   TIMEOUT_MINS="${2:?--timeout-mins requires a value}"; shift 2 ;;
        --timeout-mins=*) TIMEOUT_MINS="${1#--timeout-mins=}"; shift ;;
        --keep-app)       KEEP_APP=1; shift ;;
        -h|--help)        usage; exit 0 ;;
        *) echo "[run-baseline] unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

if ! [ "$N" -eq "$N" ] 2>/dev/null; then
    echo "[run-baseline] --n must be an integer; got '$N'" >&2; exit 2
fi
if [ "$N" -lt 1 ]; then
    echo "[run-baseline] --n must be >= 1" >&2; exit 2
fi
if ! [ "$TIMEOUT_MINS" -eq "$TIMEOUT_MINS" ] 2>/dev/null || [ "$TIMEOUT_MINS" -lt 1 ]; then
    echo "[run-baseline] --timeout-mins must be a positive integer; got '$TIMEOUT_MINS'" >&2; exit 2
fi
if [ ! -f "$SEED" ];    then echo "[run-baseline] seed not found: $SEED" >&2; exit 2; fi
if [ ! -f "$ANSWERS" ]; then echo "[run-baseline] answers not found: $ANSWERS" >&2; exit 2; fi
if ! command -v claude >/dev/null 2>&1; then
    echo "[run-baseline] 'claude' CLI not on PATH; cannot dispatch /weave." >&2; exit 2
fi
if ! command -v timeout >/dev/null 2>&1; then
    echo "[run-baseline] 'timeout' (coreutils) not on PATH." >&2; exit 2
fi

cd "$REPO_ROOT"
mkdir -p .loom

PARSER="$REPO_ROOT/orchestrator/weave/lib/pipeline-parser.py"
ANALYTICS_ROOT="$REPO_ROOT/orchestrator/evaluation/analytics"
# Per-iteration safety cap. With the autonomy directive one /weave call
# drives the full lifecycle; retries resume the SAME session so their
# subagents accumulate under one transcripts dir.
MAX_ATTEMPTS=5

# Injected via `claude --append-system-prompt` so the orchestrator drives
# the lifecycle to completion without blocking on the rerun-or-continue
# AskUserQuestion. Lives in the harness, not in SKILL.md, so interactive
# /weave keeps its gates.
AUTONOMY_PROMPT='Goal: autonomously drive the entire /weave run to completion in this single invocation. Non-interactive eval mode: never block on the rerun-or-continue AskUserQuestion at any phase gate, including the Review final gate; select the Continue option and advance. Never invoke Run quality check (opt-in only). Never invoke Go back to <prior-phase>. Drive the lifecycle until pipeline.md.Lifecycle state == complete and then exit.'

CLAUDE_VERSION="$(claude --version 2>/dev/null | head -1)"
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY=0
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | head -1)" ]; then
    GIT_DIRTY=1
fi

failures=0
ts="$(date -u +%s)"
for i in $(seq 1 "$N"); do
    project="baseline-${ts}-${i}"
    workspace=".loom/$project"
    pipeline="$workspace/pipeline.md"
    logs="$workspace/.eval-logs"
    mkdir -p "$workspace" "$logs"
    cp "$SEED" "$workspace/seed.md"
    # Validate and stage the answer queue under .loom/<project>/.answers.yaml.
    # The Spec grilling agent reads the staged file if present.
    if ! python3 "$SCRIPT_DIR/answer-queue.py" validate "$ANSWERS" >/dev/null 2>&1; then
        echo "[run-baseline] iteration $i: invalid answer queue $ANSWERS; aborting iteration" >&2
        failures=$((failures + 1))
        continue
    fi
    cp "$ANSWERS" "$workspace/.answers.yaml"
    # Mark as harness-driven: auto-advance in other sessions skips this
    # project, and analyse/debug tooling can tell eval runs from real ones.
    touch "$workspace/.eval-run"

    # Session UUID chosen up front: the pointer exists before /weave starts,
    # so harvest never depends on hook wiring.
    session_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    printf '%s\n' "$session_id" > "$workspace/.eval-orchestrator-pointer"

    echo "[run-baseline] iteration $i / $N — project $project — session $session_id" >&2
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    attempt=0
    iteration_failed=0
    failure_reason=""
    while : ; do
        attempt=$((attempt + 1))
        if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
            echo "[run-baseline] iteration $i aborted after $MAX_ATTEMPTS attempts without reaching Lifecycle complete" >&2
            iteration_failed=1
            failure_reason="max_attempts"
            break
        fi
        claude_args=(--print --output-format json
                     --permission-mode bypassPermissions
                     --append-system-prompt "$AUTONOMY_PROMPT")
        if [ -n "$MODEL" ]; then
            claude_args+=(--model "$MODEL")
        fi
        if [ "$attempt" -eq 1 ]; then
            claude_args+=(--session-id "$session_id")
        else
            echo "[run-baseline]   retry $((attempt - 1)) — resuming session $session_id" >&2
            claude_args+=(--resume "$session_id")
        fi
        timeout --kill-after=60 "${TIMEOUT_MINS}m" \
            claude "${claude_args[@]}" "/weave $project" \
            > "$logs/attempt-$attempt.json" 2> "$logs/attempt-$attempt.stderr"
        rc=$?
        if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
            echo "[run-baseline] iteration $i: attempt $attempt timed out after ${TIMEOUT_MINS}m" >&2
            iteration_failed=1
            failure_reason="timeout"
            break
        fi
        if [ "$rc" -ne 0 ]; then
            echo "[run-baseline] iteration $i: claude exit $rc on attempt $attempt (see $logs/attempt-$attempt.stderr)" >&2
            iteration_failed=1
            failure_reason="claude_exit_$rc"
            break
        fi
        if [ ! -f "$pipeline" ]; then
            echo "[run-baseline] iteration $i: pipeline.md missing after attempt $attempt; aborting iteration" >&2
            iteration_failed=1
            failure_reason="pipeline_missing"
            break
        fi
        lifecycle="$(python3 "$PARSER" field "$pipeline" "Lifecycle state" 2>/dev/null || echo "")"
        if [ "$lifecycle" = "complete" ]; then
            echo "[run-baseline] iteration $i complete after $attempt attempt(s)" >&2
            break
        fi
    done
    ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [ "$iteration_failed" -eq 1 ]; then
        failures=$((failures + 1))
    fi

    # ---- telemetry: harvest + aggregate + outcome, even for failed runs ----
    session_args=()
    while IFS= read -r sid; do
        [ -n "$sid" ] && session_args+=(--session "$sid")
    done < "$workspace/.eval-orchestrator-pointer"
    python3 "$TELEMETRY/transcript-harvest.py" "$project" \
        --workspace "$workspace" --cwd "$REPO_ROOT" "${session_args[@]}" \
        > "$logs/harvest.log" 2>&1 \
        || echo "[run-baseline] iteration $i: harvest failed (see $logs/harvest.log)" >&2
    python3 "$TELEMETRY/eval-aggregate.py" "$project" --loom-root "$REPO_ROOT/.loom" \
        >/dev/null 2>&1 \
        || echo "[run-baseline] iteration $i: aggregate failed" >&2
    python3 "$TELEMETRY/run-outcome.py" "$workspace" >/dev/null 2>&1 \
        || echo "[run-baseline] iteration $i: outcome derivation failed" >&2

    # ---- run-meta.json: authoritative whole-run totals + confounders ----
    RB_WORKSPACE="$workspace" RB_PROJECT="$project" RB_STARTED="$started_at" \
    RB_ENDED="$ended_at" RB_ATTEMPTS="$attempt" RB_FAILED="$iteration_failed" \
    RB_REASON="$failure_reason" RB_CLAUDE_VERSION="$CLAUDE_VERSION" \
    RB_GIT_SHA="$GIT_SHA" RB_GIT_DIRTY="$GIT_DIRTY" RB_MODEL_FLAG="$MODEL" \
    RB_SEED="$SEED" RB_ANSWERS="$ANSWERS" \
    python3 - <<'PYEOF' || echo "[run-baseline] run-meta.json write failed" >&2
import hashlib, json, os
from pathlib import Path

ws = Path(os.environ["RB_WORKSPACE"])
logs = ws / ".eval-logs"

attempts = []
total_cost = 0.0
cost_known = False
num_turns = 0
duration_ms = 0
models = set()
for p in sorted(logs.glob("attempt-*.json")):
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        attempts.append({"file": p.name, "parse_error": True})
        continue
    entry = {
        "file": p.name,
        "session_id": data.get("session_id"),
        "subtype": data.get("subtype"),
        "is_error": data.get("is_error"),
        "num_turns": data.get("num_turns"),
        "duration_ms": data.get("duration_ms"),
        "total_cost_usd": data.get("total_cost_usd"),
    }
    attempts.append(entry)
    if isinstance(data.get("total_cost_usd"), (int, float)):
        total_cost += data["total_cost_usd"]
        cost_known = True
    if isinstance(data.get("num_turns"), int):
        num_turns += data["num_turns"]
    if isinstance(data.get("duration_ms"), (int, float)):
        duration_ms += int(data["duration_ms"])
    mu = data.get("modelUsage")
    if isinstance(mu, dict):
        models.update(mu.keys())

def sha256(path):
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]
    except OSError:
        return None

pointer = ws / ".eval-orchestrator-pointer"
session_ids = []
if pointer.is_file():
    session_ids = [l.strip() for l in pointer.read_text().splitlines() if l.strip()]

meta = {
    "project": os.environ["RB_PROJECT"],
    "started_at": os.environ["RB_STARTED"],
    "ended_at": os.environ["RB_ENDED"],
    "attempts": int(os.environ["RB_ATTEMPTS"]),
    "failed": os.environ["RB_FAILED"] == "1",
    "failure_reason": os.environ["RB_REASON"] or None,
    "session_ids": session_ids,
    "models": sorted(models),
    "model_flag": os.environ["RB_MODEL_FLAG"] or None,
    "claude_version": os.environ["RB_CLAUDE_VERSION"] or None,
    "loom_git_sha": os.environ["RB_GIT_SHA"],
    "loom_git_dirty": os.environ["RB_GIT_DIRTY"] == "1",
    "seed_sha256": sha256(os.environ["RB_SEED"]),
    "answers_sha256": sha256(os.environ["RB_ANSWERS"]),
    "total_cost_usd": round(total_cost, 6) if cost_known else None,
    "num_turns": num_turns,
    "duration_ms": duration_ms,
    "attempt_results": attempts,
}
(ws / "run-meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
PYEOF

    # ---- optional filing into analytics/<version>/ ----
    if [ -n "$VERSION" ]; then
        dest="$ANALYTICS_ROOT/$VERSION"
        mkdir -p "$dest"
        if [ "$KEEP_APP" -eq 0 ] && [ -d "$workspace/app" ]; then
            rm -rf "$workspace/app"
        fi
        if mv "$workspace" "$dest/"; then
            echo "[run-baseline] iteration $i filed under analytics/$VERSION/$project" >&2
        else
            echo "[run-baseline] iteration $i: filing into $dest failed; run left at $workspace" >&2
        fi
    fi
done

echo "[run-baseline] done: $N iteration(s), $failures failed" >&2
if [ -n "$VERSION" ]; then
    echo "[run-baseline] next: pnpm run eval:analyse" >&2
fi
exit 0
