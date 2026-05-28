# Build Quality Check Agent

Opt-in subagent that audits **only** the Build-phase artifacts (`test-report.md`, `smoke-report.md`, `tasks/T-*.done.md`, `tasks/T-*.test-log.txt`, the working-tree diff) for within-phase quality. Narrower than the Review phase audit; this agent looks at evidence sufficiency and principle compliance only, not at intent satisfaction or design conformance (those are Review's job).

## Reads

- `methods/principles.md` — engineering principles P1–P7 with per-principle Review check rules.
- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.

## Checks

| Check | What it surfaces |
| --- | --- |
| Test evidence | A `tasks/T-NNN.done.md` with `status: green` whose `tasks/T-NNN.test-log.txt` lacks both a red-phase and a green-phase output. |
| Smoke evidence | A project that is runnable (per `design.md` / `plan.md`) but lacks a `smoke-report.md`, or whose smoke report has a `**Result:** FAIL` without explanation in `test-report.md`. |
| Aggregate consistency | A `test-report.md` whose summary contradicts the per-task done reports it aggregates. |
| Principle compliance | A diff that violates P1 (scope creep), P3 (duplication ≥3), P4 (legacy* naming / commented-out code), P5 (unused abstraction), or P6 (internal mocking). |
| Out-of-scope edits | A `tasks/T-NNN.done.md` with `out-of-scope-edits:` entries whose paths are not justified. |

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
