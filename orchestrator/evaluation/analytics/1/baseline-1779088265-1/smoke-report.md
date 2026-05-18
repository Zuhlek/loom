---
project: baseline-1779088265-1
phase: build
created: 2026-05-18
gate: smoke
result: PASS
---

# Smoke Report — baseline-1779088265-1

Verification environment: `node-test` + `cli-shell` (per plan.md § Verification environment). No `headless-browser` step is required — UI gates are exercised via jsdom in `client-render.test.ts` and `client-form.test.ts`.

## Checks

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Build artifacts complete (`dist/server/*.js`, `public/bundle.js`, `public/index.html`, `public/styles.css`) | PASS | `npm run build:client` + `npm run build:server` complete; outputs present under `app/dist/` and `app/public/` |
| 2 | App starts successfully | PASS | `npm start` prints `Bookmarks listening on http://localhost:3000`; no crash within 5s |
| 3 | Key endpoints respond | PASS | See § "tests.md § Smoke gate" below |
| 4 | UI screens render when UI changed | SKIPPED (covered by jsdom) | Plan declares `node-test` env; `headless-browser` not required. UI rendering exercised by `client-render.test.ts` (14 cases) + `client-form.test.ts` (4 cases), all green. Chrome/Chromium not installed locally. |
| 5 | Tests did not corrupt shared state | PASS | Smoke test puts `DATA_DIR` under `os.tmpdir()` (per T-008.done.md); no writes outside `app/` |

## tests.md § Smoke gate (explicit, all 8 steps)

| # | Step | Result |
| --- | --- | --- |
| 1 | `npm install` (already installed) | OK |
| 2 | `npm test` → exits 0 (61/61 pass across 10 files) | PASS |
| 3 | `npm start &` → port `:3000` accepts TCP | PASS |
| 4 | `curl http://localhost:3000/` → `200` | PASS |
| 5 | `curl http://localhost:3000/api/bookmarks` → `{"bookmarks":[]}` on fresh `data/` | PASS |
| 6 | `POST /api/bookmarks {url, title}` → `201` + bookmark body | PASS (`{"bookmark":{"id":1,"url":"https://example.com","title":"Example","createdAt":1779092876586}}`) |
| 7 | Kill background server | PASS (SIGTERM, port released within 1s) |
| 8 | No files written outside `app/` (vs allowlist) | PASS — only `app/data/bookmarks.db*` (declared) and `app/public/bundle.js` (build output) |

## Cross-cutting non-functional gates (tests.md)

| Gate | Result | Evidence |
| --- | --- | --- |
| No-`innerHTML` rule (`src/client/**/*.ts`) | PASS | `grep -RIn -E '\binnerHTML\s*=' src/client/` → 0 matches |
| Workspace isolation during `npm test` / `npm start` | PASS | Smoke test uses `os.tmpdir()`; server `data/` lives at `app/data/` |
| TypeScript strict (`tsc --noEmit`) | PASS | `tsconfig.json` exit 0; `tsconfig.client.json` exit 0 |

## Test suite summary

```
Test Files  10 passed (10)
     Tests  61 passed (61)
  Duration  2.37s
```

Per-file: `db.test.ts` (6), `repo.test.ts` (10), `app-factory.test.ts` (7), `routes-create.test.ts` (6), `routes-delete.test.ts` (5), `routes-list.test.ts` (2), `shared-types.test.ts` (1), `client-form.test.ts` (4), `client-render.test.ts` (14), `smoke.test.ts` (6).

## Findings

None. All gates pass. One pre-existing orphaned `node dist/server/index.js` (PID 78948, parented to init) was bound to `:3000` before this run from a prior T-008 task run; killed before re-running the suite. This is a transient pre-condition, not a regression — the smoke test's `killServer` helper escalates to `SIGKILL` and waits for the port to free, so the test is robust against itself; but the prior orphan was outside that lifecycle.
