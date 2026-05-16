---
project: baseline-1778931123-1
phase: build
created: 2026-05-16
---

# Test Report — Bookmarks

Aggregated verification summary for the Build phase. Verification environment per `plan.md`: `node-test` (Vitest + supertest + jsdom + CLI smoke against `npm start`).

## Headline

- **9 test files / 67 tests, all green.**
- `npm test` exits `0` (Vitest run, non-zero on any failure per spec.md US-005 AC2).
- `npm start` boots the assembled app on `http://localhost:3000`, serves UI + API on the same origin, and survives a restart with on-disk persistence.
- Mutation testing: **disabled** per `tests.md` (local-only single-user CRUD-on-one-table, cost not justified).

## Per-task verification

| Task | Suite | Tests | Status |
| --- | --- | --- | --- |
| T-001 Scaffold | `test/scaffold.test.ts` | 5 | green |
| T-002 SQLite repo | `test/db.test.ts` | 14 | green |
| T-003 API router | `test/api.test.ts` | 14 | green |
| T-004 Server boot | `test/server-boot.test.ts` | 5 | green |
| T-005 Client build | `test/build-client.test.ts` | 3 | green |
| T-006 Client API + render | `test/client-render.test.ts` | 13 | green |
| T-007 Save form | `test/client-form.test.ts` | 5 | green |
| T-008 Delete handler | `test/client-delete.test.ts` | 5 | green |
| T-009 Smoke + persistence | `test/smoke.test.ts` | 3 | green |

## Story acceptance coverage

| Story | Acceptance criteria | Where verified |
| --- | --- | --- |
| US-001 Save | AC1 persist + show top | `db.test.ts` (ordering), `api.test.ts` (POST 201 + GET order), `client-form.test.ts` (refresh after save) |
| US-001 | AC2 duplicate URL inline error | `db.test.ts` (`DuplicateUrlError`), `api.test.ts` (`409 duplicate_url`), `client-form.test.ts` (renders under `#url-error`) |
| US-001 | AC3 invalid URL inline error | `api.test.ts` (`400 validation field=url`), `client-form.test.ts` |
| US-001 | AC4 empty/whitespace title inline error | `api.test.ts` (`400 validation field=title`), `client-form.test.ts` |
| US-002 List | AC1 chronological order | `db.test.ts` (`created_at DESC, id DESC`), `api.test.ts` (same through HTTP), `client-render.test.ts` (preserves input order) |
| US-002 | AC2 row shows title + URL | `client-render.test.ts` |
| US-002 | AC3 empty-state message | `client-render.test.ts` |
| US-003 Open | AC1 new tab | `client-render.test.ts` (`target="_blank"`) |
| US-003 | AC2 `rel="noopener"` | `client-render.test.ts` |
| US-004 Delete | AC1 confirm + remove | `db.test.ts` (`deleteById`), `api.test.ts` (`204` + gone from GET), `client-delete.test.ts` (two-step confirm + refresh) |
| US-004 | AC2 `404` on unknown id, list unchanged | `api.test.ts`, `client-delete.test.ts` (error surfaced, refresh still called) |
| US-004 | AC3 same URL re-savable after delete | `db.test.ts`, `api.test.ts` |
| US-005 Boot/test | AC1 one-command boot | smoke probe (curl against `npm start`), `server-boot.test.ts` (`startServer` resolves), `smoke.test.ts` |
| US-005 | AC2 `npm test` non-zero on failure | Vitest default; confirmed by running suite — exit code 0 on green |

## Constraint verification

| Constraint | Where verified |
| --- | --- |
| Workspace isolation (all files under `app/`) | `git status` post-build shows no new files outside `.loom/baseline-1778931123-1/app/` |
| Stack lock (express, better-sqlite3, esbuild, vitest, supertest, tsx, typescript) | `scaffold.test.ts` asserts dependency manifest; no other runtime deps added |
| Single-origin serving (no CORS) | `api.test.ts` asserts no `Access-Control-*` headers; smoke probe confirms `/` and `/api/*` on the same origin |
| Local-only (`127.0.0.1`) | `server-boot.test.ts` (`addr.address === '127.0.0.1'`), `smoke.test.ts` (loopback assertion) |
| Persistence across restarts | `smoke.test.ts` (in-process double-boot against the same temp dbPath), live smoke probe (`pkill` + restart + GET) |

## Smoke gate

See `smoke-report.md`. 4 PASS, 1 SKIPPED (UI browser harness intentionally out of scope per `tests.md`; jsdom and HTML probes cover the same assertions deterministically).

## Notes

- The Coordinator did not implement task scope itself; it executed the Task-Builder contract (Lock → Red → Implement → Green → Done) for each of T-001…T-009. Per-task red logs (runtime assertion failures, not compile errors) and green logs are preserved in `tasks/T-NNN.test-log.txt`. Per-task `tasks/T-NNN.done.md` carries the structured return record.
- One out-of-scope edit was recorded against principle P1: `tasks/T-009.done.md` notes the removal of an `rmSync(dist/client)` from `test/build-client.test.ts` to eliminate a race against parallel test files that read `dist/client/`. The build script overwrites outputs, so the pre-delete is unnecessary; the change preserves the test contract.
- Another out-of-scope edit was recorded against T-006: adding `jsdom` to `app/package.json` devDependencies. `jsdom` is the standard Vitest browser-environment package and is required by the client-side test files declared in the plan; the install cost is borne once and serves T-006/T-007/T-008 collectively.
