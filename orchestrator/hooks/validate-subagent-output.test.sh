#!/usr/bin/env bash
# Behaviour test for validate-subagent-output.py. Run from anywhere:
#   bash orchestrator/hooks/validate-subagent-output.test.sh
# Exits non-zero on the first failing case. Prints `ok: <case>` per pass.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-subagent-output.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

# run_hook <cwd> <transcript_path> → hook stdout
run_hook() {
    python3 -c "import json,sys; sys.stdout.write(json.dumps({'transcript_path': sys.argv[1], 'cwd': sys.argv[2]}))" \
        "$2" "$1" | python3 "$HOOK"
}

# mk_transcript <path> <phase> <status> <artifacts-inline>
mk_transcript() {
    cat > "$1" <<EOF
some preamble output

phase: $2
status: $3
artifacts: $4
summary: test run
EOF
}

expect_block() {
    # $1 = hook output, $2 = reason substring, $3 = case label
    printf '%s' "$1" | grep -q '"decision": "block"' || fail "$3: expected a block, got: $1"
    printf '%s' "$1" | grep -qF "$2" || fail "$3: reason missing '$2', got: $1"
    pass "$3"
}

expect_pass() {
    # $1 = hook output, $2 = case label
    [ -z "$1" ] || fail "$2: expected empty output (no block), got: $1"
    pass "$2"
}

# mk_plan_workspace <ws> — a fully valid plan workspace for project `demo`
mk_plan_workspace() {
    local ws="$1"
    mkdir -p "$ws/.loom/demo/tasks"
    printf 'demo' > "$ws/.loom/.active"

    cat > "$ws/.loom/demo/spec.md" <<'EOF'
# Spec

## User stories

### US-001: Do the thing
<!-- loom:story id=US-001 status=active -->
**Acceptance criteria:** the system shall do the thing.
<!-- loom:story-end id=US-001 -->

### US-002: Superseded thing
<!-- loom:story id=US-002 status=superseded -->
<!-- loom:story-end id=US-002 -->
EOF

    cat > "$ws/.loom/demo/plan.md" <<'EOF'
# Plan

## Approach & sequencing

1. Walking skeleton first.

## Plan decisions

### Verification environment
- **Context:** need a harness
- **Decision:** cli-shell
- **Rationale:** fits
- **Alternatives:** none viable

## Risks

(none identified)

## Verification environment

cli-shell
EOF

    cat > "$ws/.loom/demo/tests.md" <<'EOF'
**Mutation Testing:** no

Strategy prose.
EOF

    cat > "$ws/.loom/demo/board.md" <<'EOF'
# Board — demo

## Backlog
- T-001 Do the thing — touches: route, service

## In Progress
- (none)

## Review
- (none)

## Done
- (none)
EOF

    cat > "$ws/.loom/demo/tasks/T-001.md" <<'EOF'
---
id: T-001
title: Do the thing end to end
type: AFK
status: Backlog
blocked-by: []
satisfies-stories: [US-001]
touches-layers: route, service
files-likely-touched:
  - src/thing.ts
---

Test sketch: pins US-001 AC1.
EOF
}

# --------------------------------------------------------------------------- #
# 1. schema basics still hold
# --------------------------------------------------------------------------- #
WS1="$TMP/ws1"; mk_plan_workspace "$WS1"

T="$TMP/t-badstatus.txt"; mk_transcript "$T" plan "greenish" "[plan.md]"
expect_block "$(run_hook "$WS1" "$T")" "invalid status for plan" "invalid status blocks"

T="$TMP/t-nosummary.txt"
printf 'phase: plan\nstatus: complete\nartifacts: [plan.md]\n' > "$T"
expect_block "$(run_hook "$WS1" "$T")" "must include summary" "missing summary blocks"

T="$TMP/t-vestigial.txt"; mk_transcript "$T" build-task "green" "[x]"
expect_pass "$(run_hook "$WS1" "$T")" "retired build-task vocabulary is ignored"

# --------------------------------------------------------------------------- #
# 2. valid plan workspace passes
# --------------------------------------------------------------------------- #
T="$TMP/t-valid.txt"; mk_transcript "$T" plan complete "[plan.md, board.md]"
expect_pass "$(run_hook "$WS1" "$T")" "valid plan workspace passes"

# --------------------------------------------------------------------------- #
# 3. non-complete plan return skips graph validation
# --------------------------------------------------------------------------- #
WS2="$TMP/ws2"; mk_plan_workspace "$WS2"
rm "$WS2/.loom/demo/board.md"
T="$TMP/t-blocked.txt"; mk_transcript "$T" plan blocked "[plan.md]"
expect_pass "$(run_hook "$WS2" "$T")" "blocked plan return skips graph validation"

# --------------------------------------------------------------------------- #
# 4. graph violations block
# --------------------------------------------------------------------------- #
T="$TMP/t-complete.txt"; mk_transcript "$T" plan complete "[plan.md]"

WS3="$TMP/ws3"; mk_plan_workspace "$WS3"
sed -i 's/satisfies-stories: \[US-001\]/satisfies-stories: []/' "$WS3/.loom/demo/tasks/T-001.md"
out="$(run_hook "$WS3" "$T")"
expect_block "$out" "satisfies-stories must list at least one" "empty satisfies-stories blocks"
printf '%s' "$out" | grep -qF "US-001" || fail "story coverage: uncovered story not named"
pass "uncovered active story blocks"

WS4="$TMP/ws4"; mk_plan_workspace "$WS4"
sed -i 's/blocked-by: \[\]/blocked-by: [T-099]/' "$WS4/.loom/demo/tasks/T-001.md"
expect_block "$(run_hook "$WS4" "$T")" "references missing task T-099" "dangling blocked-by blocks"

WS5="$TMP/ws5"; mk_plan_workspace "$WS5"
sed -i 's/blocked-by: \[\]/blocked-by: [T-002]/' "$WS5/.loom/demo/tasks/T-001.md"
cat > "$WS5/.loom/demo/tasks/T-002.md" <<'EOF'
---
id: T-002
title: Second thing observable
type: AFK
status: Backlog
blocked-by: [T-001]
satisfies-stories: [US-001]
touches-layers: service
files-likely-touched: [src/thing.ts]
---
EOF
cat >> "$WS5/.loom/demo/board.md" <<'EOF'
EOF
sed -i 's/- T-001 Do the thing — touches: route, service/- T-001 Do the thing — touches: route, service\n- T-002 Second thing (blocked by T-001) — touches: service/' "$WS5/.loom/demo/board.md"
expect_block "$(run_hook "$WS5" "$T")" "contains a cycle" "blocked-by cycle blocks"

WS6="$TMP/ws6"; mk_plan_workspace "$WS6"
sed -i '/^type: AFK$/d' "$WS6/.loom/demo/tasks/T-001.md"
expect_block "$(run_hook "$WS6" "$T")" "missing frontmatter fields" "missing frontmatter field blocks"

WS7="$TMP/ws7"; mk_plan_workspace "$WS7"
sed -i 's/^## Plan decisions$/## Decisions/' "$WS7/.loom/demo/plan.md"
expect_block "$(run_hook "$WS7" "$T")" "missing required section '## Plan decisions'" "missing plan.md section blocks"

WS8="$TMP/ws8"; mk_plan_workspace "$WS8"
sed -i 's/^## Review$/## Waiting/' "$WS8/.loom/demo/board.md"
expect_block "$(run_hook "$WS8" "$T")" "board.md columns" "wrong board columns block"

WS9="$TMP/ws9"; mk_plan_workspace "$WS9"
sed -i 's/^\*\*Mutation Testing:\*\* no$/Mutation: maybe/' "$WS9/.loom/demo/tests.md"
expect_block "$(run_hook "$WS9" "$T")" "Mutation Testing" "missing mutation declaration blocks"

WS10="$TMP/ws10"; mk_plan_workspace "$WS10"
sed -i 's/^- T-001 .*$/- (none)/' "$WS10/.loom/demo/board.md"
expect_block "$(run_hook "$WS10" "$T")" "appears on 0 board cards" "task missing from board blocks"

# --------------------------------------------------------------------------- #
# 5. other phases untouched by graph validation
# --------------------------------------------------------------------------- #
WS11="$TMP/ws11"; mk_plan_workspace "$WS11"
rm "$WS11/.loom/demo/tasks/T-001.md"
T="$TMP/t-spec.txt"; mk_transcript "$T" spec complete "[spec.md]"
expect_pass "$(run_hook "$WS11" "$T")" "spec return does not run plan validation"

echo "all cases passed"
