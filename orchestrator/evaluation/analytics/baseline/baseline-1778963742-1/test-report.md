---
project: baseline-1778963742-1
phase: build
created: 2026-05-16
---

# Test report — baseline-1778963742-1

## Aggregate

- **Test files:** 5
- **Total tests:** 32
- **Passed:** 32
- **Failed:** 0
- **Skipped:** 0
- **Mutation testing:** skipped (declared `no` in `tests.md`)

## Per-task evidence

| Task  | Tests added                                                 | Result       | Attempts |
| ----- | ----------------------------------------------------------- | ------------ | -------- |
| T-001 | (tooling only — `passWithNoTests`)                          | exit 0       | 1        |
| T-002 | `tests/validation.test.ts` (8), `tests/repo.test.ts` (6)    | 14/14 green  | 1        |
| T-003 | `tests/api.bookmarks.test.ts` (11 supertest)                | 11/11 green  | 2        |
| T-004 | `tests/client.render.test.ts` (4 happy-dom)                 | 4/4 green    | 2        |
| T-005 | `tests/e2e.smoke.test.ts` (3 ephemeral-port end-to-end)     | 3/3 green    | 1        |

Per-task `tasks/T-NNN.test-log.txt` files hold the raw vitest output for each
red / green run.

## Acceptance-criterion coverage (rolled up from tests.md)

All US-001..US-004 acceptance rows in `tests.md §Coverage by acceptance
criterion` resolve to passing assertions across the four real test files. The
duplicate-rejection and URL-normalisation contract (US-001 AC3 + ADR-009) is
exercised at three layers: repo unit, supertest integration, and smoke
HTTP. The delete-of-missing path (US-004 AC3) is exercised at repo, supertest
404 path, and client-render banner (via the unit test that asserts the
list-error slot exists in the DOM contract).

## Smoke gate

Smoke checks 1–5 all PASS — see `smoke-report.md`. Smoke substitution
(curl-based UI check) documented in that file.

## Verdict

`status: complete`. All five tasks Done, full suite green, smoke green.
