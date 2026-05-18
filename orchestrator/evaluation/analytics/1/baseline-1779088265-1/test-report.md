---
project: baseline-1779088265-1
phase: build
created: 2026-05-18
result: PASS
---

# Test Report — baseline-1779088265-1 (Bookmarks)

Aggregated verification evidence across the eight Build tasks (T-001..T-008), the cross-cutting smoke gate, and the cross-cutting non-functional gates declared in `tests.md`.

## Outcome

All eight tasks reached `Done`. The build is complete.

| Metric | Count |
| --- | --- |
| Tasks attempted | 8 |
| Tasks `green` | 8 |
| Tasks `failed` | 0 |
| Tasks `hitl-block` | 0 |
| Total Vitest cases | 61 (10 files) |
| Vitest failures | 0 |
| `tsc --noEmit` failures | 0 (server + client) |
| Smoke gate steps | 8/8 PASS |

## Per-task verification

| Task | Status | Attempts | Test log | Done report |
| --- | --- | --- | --- | --- |
| T-001 Bootstrap workspace + shared types | green | 1 | `tasks/T-001.test-log.txt` | `tasks/T-001.done.md` |
| T-002 SQLite open + schema migration | green | 1 | `tasks/T-002.test-log.txt` | `tasks/T-002.done.md` |
| T-003 Express app factory + error handler | green | 1 | `tasks/T-003.test-log.txt` | `tasks/T-003.done.md` |
| T-004 Save a bookmark end-to-end | green | 1 | `tasks/T-004.test-log.txt` | `tasks/T-004.done.md` |
| T-005 List bookmarks newest-first | green | 1 | `tasks/T-005.test-log.txt` | `tasks/T-005.done.md` |
| T-006 Open a bookmark in a new tab | green | 1 | `tasks/T-006.test-log.txt` | `tasks/T-006.done.md` |
| T-007 Delete a bookmark | green | 1 | `tasks/T-007.test-log.txt` | `tasks/T-007.done.md` |
| T-008 Boot + static shell + smoke gate | green | 1 | `tasks/T-008.test-log.txt` | `tasks/T-008.done.md` |

Each task's red phase produced an assertion failure (not a compile error) in its `test-log.txt` before the corresponding implementation flipped it green. T-008's red phase produced 5 assertion failures (3× port-bind, 1× stderr mismatch, 1× HTML shape) — all green on attempt 1.

## Test suite (Vitest, final)

```
Test Files  10 passed (10)
     Tests  61 passed (61)
  Start at  10:27:23
  Duration  2.37s
```

By surface:

- **db** (`db.test.ts`, 6) — open, migration, idempotency, foreign keys.
- **repo** (`repo.test.ts`, 10) — insert / list / delete; `DuplicateUrlError` on collision; ordering ties; `created_at` window.
- **routes** (`app-factory.test.ts` 7, `routes-create.test.ts` 6, `routes-delete.test.ts` 5, `routes-list.test.ts` 2) — status codes, error envelope, `400` on malformed input, `204` on idempotent DELETE, `409` on duplicate URL, `BAD_ID` on non-integer id.
- **shared-types** (`shared-types.test.ts`, 1) — round-trip types compile + serialize.
- **client-form** (`client-form.test.ts`, 4) — `idle → submitting → idle/error` transitions; inline error text reflects server `message`.
- **client-render** (`client-render.test.ts`, 14) — anchor `href`, `target="_blank"`, `rel="noopener noreferrer"`; empty-state copy; delete control re-renders.
- **smoke** (`smoke.test.ts`, 6) — HTML shell + bundle + stylesheet; create→list→delete round trip; restart persistence; bad-DATA_DIR exit; dark-mode media query; no-`innerHTML` regex over `src/client/**/*.ts`.

## Per-story acceptance gates

| Story | Gate | Covered by | Result |
| --- | --- | --- | --- |
| US-001 Save | AC1..AC4 + client gate | `routes-create.test.ts`, `repo.test.ts`, `client-form.test.ts` | PASS |
| US-002 List newest-first | AC1..AC3 | `routes-list.test.ts`, `client-render.test.ts` (empty state) | PASS |
| US-003 Open in new tab | anchor attrs | `client-render.test.ts` | PASS |
| US-004 Delete | AC1..AC3 + negative | `routes-delete.test.ts`, `client-render.test.ts` | PASS |

## Cross-cutting non-functional gates

| Gate | Result |
| --- | --- |
| No-`innerHTML` rule | PASS — 0 matches under `src/client/**/*.ts` |
| Workspace isolation | PASS — only `app/data/` + `app/public/bundle.js` written |
| `tsc --noEmit` strict (server) | PASS — exit 0 |
| `tsc --noEmit` strict (client) | PASS — exit 0 |

## Smoke gate

PASS — see `smoke-report.md`. All 8 explicit steps from `tests.md § Smoke gate (explicit)` succeeded.

## Mutation gate

Skipped per `tests.md`: `Mutation Testing: no`.

## Verification environment compliance

Plan declared `node-test` + `cli-shell`; both executable by the Coordinator. No `headless-browser` or `manual-browser-desktop` step required (UI gates run under jsdom). Pre-flight passed; no env mismatch.

## Artifacts produced this phase

- `.loom/baseline-1779088265-1/board.md` (all cards in `Done`)
- `.loom/baseline-1779088265-1/tasks/T-001.done.md` .. `T-008.done.md`
- `.loom/baseline-1779088265-1/tasks/T-001.test-log.txt` .. `T-008.test-log.txt`
- `.loom/baseline-1779088265-1/smoke-report.md`
- `.loom/baseline-1779088265-1/test-report.md` (this file)
- `.loom/baseline-1779088265-1/app/**` (implementation)

## Open ambiguity

None.
