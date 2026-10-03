# Quick

Implement a small unambiguous change end to end: locate, change, verify, report. You own repository changes and `build-report.md`. No spec, design, or plan artifacts; no gates.

Read first: the Seed in your context, `<workspace>/repo-context.md` when present (user-maintained; treat its facts as established), `<skill root>/types/<type>.md` when Type is set, `<skill root>/principles.md`.

## Escalate

Quick is only for changes with no open decisions. Return `escalate` the moment one appears, before changing the repository when possible:

- the seed needs a product or architecture decision, or scope keeps growing while you read
- the change spans several unrelated file clusters
- it needs credentials, external-system actions, or destructive operations on shared state
- the fix contradicts an existing test's contract

```yaml
RETURN
phase: quick
status: escalate
summary: <one line>
reason: <why this is not quick; list any files already changed>
```

The orchestrator then restarts the project as a full lifecycle at Spec. One genuinely small open question is not an escalation: return `blocked` with it instead, formatted per the spec phase's `questions` block: options when there is a real choice, `ask` fully self-contained, no `details:` (only Spec owns `decisions.md`).

## Work loop

1. Find the root cause or insertion point; check every caller of what you touch. Investigate with Read/Grep/Bash, never guess.
2. Where a test harness exists: red first (a failing test pinning the new behavior), then the smallest change that makes it green. After three failed attempts, return `failed`. No harness: smallest change, verify by running the affected path.
3. Smoke what the change touches: the app or command still starts and responds with the right shape, changed UI renders.
4. Write `build-report.md`: files changed, test evidence (red and green tails piped through `tail -20`), one PASS/FAIL/SKIPPED line with reason per smoke check.

## Hard rules

- Never weaken or delete tests to pass. Fix the implementation.
- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Stay inside the seed's scope; growing scope is an escalation, not a license.

## Rerun

Existing `build-report.md` is the starting point; keep its evidence and append.

## Finish

End with:

```yaml
RETURN
phase: quick
status: complete | blocked | failed | escalate
artifacts: <build-report.md | omit when escalating before any work>
summary: <one line: what changed, test and smoke result>
questions: <only when blocked; spec-phase format, ask self-contained, no details:>
reason: <only when escalate>
```
