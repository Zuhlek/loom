---
project: baseline-1779088275-1
phase: build
created: 2026-05-18
updated: 2026-05-18
---

# Test Report — baseline-1779088275-1

Aggregated verification evidence for the Build phase. Updated after each Coordinator pass.

## Harness

`node-test` per `plan.md` § "Verification environment". `npm test` runs `tsc --noEmit` then `vitest run`; `SMOKE=1 vitest run` adds the boot-the-server smoke spec. No external services, no browser, no manual-HITL step.

## Per-task verification

| Task | Status | Attempts | Red evidence | Green evidence | Done report |
| --- | --- | --- | --- | --- | --- |
| `T-001` | Done | 1 | `tasks/T-001.test-log.txt` (smoke spec failed with status 404 before static middleware was wired) | `tasks/T-001.test-log.txt` (tsc OK; vitest 1 passed / 2 skipped; `SMOKE=1 vitest run` 3 passed) | `tasks/T-001.done.md` |
| `T-002` | Done | 1 | `tasks/T-002.test-log.txt` (7 runtime failures: `createDb: not implemented`, `renderList: not implemented`; no compile errors) | `tasks/T-002.test-log.txt` (tsc OK; vitest 7 passed / 2 skipped; Coordinator re-ran `SMOKE=1 vitest run` 9 passed) | `tasks/T-002.done.md` |
| `T-003` | Done | 1 | `tasks/T-003.test-log.txt` (18 runtime failures: `parseTitle: not implemented`, `parseUrl: not implemented`, `createBookmark: not implemented`, `showFormError: not implemented`, `clearFormErrors: not implemented`; no compile errors) | `tasks/T-003.test-log.txt` (tsc OK; vitest 27 passed / 2 skipped; Coordinator re-ran `SMOKE=1 vitest run` 29 passed) | `tasks/T-003.done.md` |
| `T-004` | Done | 1 | `tasks/T-004.test-log.txt` (2 runtime assertion failures in `render.test.ts`: `expected null to be '_blank'` at line 87; `expected null to be 'noopener noreferrer'` at line 94; no compile errors) | `tasks/T-004.test-log.txt` (tsc OK; vitest 31 passed / 2 skipped; Coordinator re-ran `SMOKE=1 vitest run` 33 passed) | `tasks/T-004.done.md` |
| `T-005` | Done | 1 | `tasks/T-005.test-log.txt` (12 runtime assertion failures: 5 in `bookmarks.test.ts` for `DELETE /api/bookmarks/:id` returning 404 before the route was wired; 4 in `render.test.ts` for the missing per-row `button[data-bookmark-id]`; 3 in `api.test.ts` for the `deleteBookmark` stub throwing `"not implemented"`; no compile errors) | `tasks/T-005.test-log.txt` (tsc OK; vitest 45 passed / 2 skipped; Coordinator re-ran `SMOKE=1 vitest run` 47 passed; live `PORT=3461 npm start` probe verified all 11 DELETE branches incl. idempotent no-op for AC-3) | `tasks/T-005.done.md` |

## Phase-wide smoke gates

See `smoke-report.md` for the full check breakdown. Summary after the T-005 pass:

- `npm install` resolves cleanly from `app/` (`package-lock.json` is checked in; no new deps were added in T-005 — the change reuses the existing Express, supertest, happy-dom, and better-sqlite3 stacks).
- `tsc --noEmit` zero errors.
- `vitest run` exits 0: 45 passed / 2 skipped (the 2 skipped are smoke specs gated by `SMOKE=1`).
- `SMOKE=1 vitest run` exits 0: 47 passed (the boot-the-server spec proves the `npm start` run contract; the in-process Vitest smoke spec also asserts the "no `data/` in project root" workspace-isolation invariant).
- Live `PORT=3461 npm start` probe: 11 endpoints exercised; `DELETE /api/bookmarks/:id` returns 204 on existing-row, 204 idempotent on re-delete, 204 idempotent on never-existed id, 400 `INVALID_ID` on non-numeric and negative ids; `GET /api/bookmarks` excludes the deleted row.
- Coordinator cleaned the `app/data/bookmarks.db` artifact that the live boot probe created so subsequent test runs start with no stale state.

## Story coverage status

| Story | Task | Status |
| --- | --- | --- |
| US-001 (save) | T-003 | Done (gates green) |
| US-002 (list) | T-002 | Done (gates green) |
| US-003 (open in new tab) | T-004 | Done (gates green) |
| US-004 (delete) | T-005 | Done (gates green) |

## Mutation testing

`tests.md` declares `**Mutation Testing:** no`. The Coordinator skips `methods/mutation.md` for this phase, as required.

## Open items

- None. Every card is in `Done`. The Build phase reports `status: complete` and is ready for the Review phase gate.
