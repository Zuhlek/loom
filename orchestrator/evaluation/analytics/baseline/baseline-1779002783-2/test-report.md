---
project: baseline-1779002783-2
phase: build
generated: 2026-05-17T09:35:00Z
---

# Test report — baseline-1779002783-2

Aggregated verification evidence for the 10-task work graph under the
`node-test` capability. Vitest runs the full suite from
`.loom/baseline-1779002783-2/app/`; the smoke script (`npm run smoke`)
exercises the live-server restart-persistence cycle.

## Final vitest run

```
 RUN  v2.1.9 .loom/baseline-1779002783-2/app
 ✓ tests/unit/client/render.test.ts (9 tests)
 ✓ tests/unit/client/form.test.ts (5 tests)
 ✓ tests/unit/client/delete.test.ts (3 tests)
 ✓ tests/unit/client/api.test.ts (6 tests)
 ✓ tests/unit/db.test.ts (5 tests)
 ✓ tests/unit/repo.test.ts (8 tests)
 ✓ tests/unit/validate.test.ts (27 tests)
 ✓ tests/integration/bookmarks.api.test.ts (12 tests)
 ✓ tests/_init.test.ts (1 test)

 Test Files  9 passed (9)
      Tests  76 passed (76)
```

## Smoke gate

`npm run smoke` — PASS. Covers US-005 AC-1 + AC-2 via a temp-dir
SQLite path that survives a `SIGINT` + respawn cycle. See
`smoke-report.md` for the per-check breakdown (build artifacts, app
starts, endpoints respond, UI rendering covered by happy-dom unit
tests, no shared-state corruption).

## Mutation testing

`tests.md` declares `Mutation Testing: no`. Not run.

## Per-task verification

| Task   | Status | Attempts | Tests added                                       |
| ------ | ------ | -------- | ------------------------------------------------- |
| T-001  | green  | 1        | `tests/_init.test.ts` (1)                         |
| T-002  | green  | 1        | `tests/unit/db.test.ts` (5)                       |
| T-003  | green  | 1        | `tests/unit/repo.test.ts` (3 list) + `tests/integration/bookmarks.api.test.ts` (2 GET) |
| T-004  | green  | 1        | `tests/unit/validate.test.ts` (27) + `tests/unit/repo.test.ts` (3 create) + integration POST (6) |
| T-005  | green  | 1        | `tests/unit/repo.test.ts` (2 delete) + integration DELETE (4) |
| T-006  | green  | 1        | `tests/unit/client/render.test.ts` (8) + `tests/unit/client/api.test.ts` (6) |
| T-007  | green  | 1        | `tests/unit/client/form.test.ts` (5)              |
| T-008  | green  | 1        | `tests/unit/client/render.test.ts` (+1 ordering)  |
| T-009  | green  | 1        | `tests/unit/client/delete.test.ts` (3)            |
| T-010  | green  | 1        | `scripts/smoke.mjs` (script-as-test)              |

Every task records both a red (runtime assertion failure or
runtime-substitute) and a green run in `tasks/T-NNN.test-log.txt`.
None reached the three-attempt cap.

## Story coverage

| Story    | Acceptance criterion                                    | Evidence                                                                |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| US-001   | AC-1 persist + visible on next GET                      | integration POST happy path; live smoke probe                           |
| US-001   | AC-2 duplicate → 409 + inline error                     | integration `POST duplicate`; client form-flow test on 409              |
| US-001   | AC-3 invalid URL → 400                                  | `validate.test.ts` (multiple cases); integration `POST ftp://x`         |
| US-001   | AC-4 empty/whitespace title → 400                       | `validate.test.ts`; integration `POST title:"   "`                      |
| US-002   | AC-1 newest-first list                                  | `repo.test.ts` ordering; integration ordering; render preserves order   |
| US-002   | AC-2 empty-state copy                                   | `render.test.ts` empty state                                            |
| US-002   | AC-3 title + URL displayed                              | `render.test.ts` populated state; `span.url`                            |
| US-003   | AC-1 opens in new tab                                   | `render.test.ts` `target="_blank"` on anchor                            |
| US-003   | AC-2 rel="noopener noreferrer"                          | `render.test.ts` rel assertion                                          |
| US-004   | AC-1 removes row                                        | `repo.test.ts` delete; integration delete + GET; client delete test     |
| US-004   | AC-2 404 on missing id                                  | `repo.test.ts` NotFoundError; integration 404; client delete test 404   |
| US-005   | AC-1 survives restart                                   | `npm run smoke` two-spawn cycle (PASS)                                  |
| US-005   | AC-2 creates file on first boot                         | `db.test.ts` migration idempotence; smoke cold start (file exists)      |

## Live endpoint probes (recorded in smoke-report.md)

All HTTP status codes match the design.md error-mapping table on a
live `npm start` process. See `smoke-report.md ## 3. Key endpoints
respond` for the response samples.

## Overall

- 76 vitest assertions pass.
- 1 smoke run passes.
- 0 mutation runs (opted out per `tests.md`).
- 10/10 tasks reached `green`. 0 failed. 0 HITL-pending.
