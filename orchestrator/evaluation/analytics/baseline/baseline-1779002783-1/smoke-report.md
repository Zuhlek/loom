---
project: baseline-1779002783-1
phase: build
created: 2026-05-17
---

# Smoke Report — Bookmarks

Smoke executed per `orchestrator/weave/phases/build/methods/smoke.md`.
All checks run from `.loom/baseline-1779002783-1/app/`.

## Check 1 — Build artifacts complete

PASS. `npm run build` produces `public/main.js` (4.6 kb). `public/index.html`
and `public/styles.css` are source-controlled (not generated). The
`prestart` script auto-builds before `npm start`, so the bundle is always
fresh when the app boots.

## Check 2 — App starts successfully

PASS.

```
$ PORT=3032 BOOKMARKS_DB=/tmp/smoke-baseline.db npm start
...
listening on http://localhost:3032
```

No crash during the first 10 seconds. Process responded to SIGTERM cleanly
(exit code 143 = 128 + 15).

## Check 3 — Key endpoints respond

PASS.

- `GET /api/bookmarks` → 200 `[]` (Content-Type: application/json; charset=utf-8)
- `GET /` → 200, 873 bytes, HTML (served from `public/index.html`)
- `POST /api/bookmarks {url, title}` → 201 with `{id, url, title, created_at}`
- `GET /api/bookmarks` after POST → contains the created row
- `DELETE /api/bookmarks/:id` (via in-suite supertest + smoke.test.ts) → 204

## Check 4 — Affected UI screens render

SKIPPED — no headless browser is available in this evaluation environment.
The frontend behaviour is exercised by:
- `tests/render.test.ts` (jsdom) for DOM render assertions including
  `target="_blank"`, `rel="noopener noreferrer"`, textContent escaping,
  empty state, inline error.
- `tests/bundle.test.ts` asserting the IIFE bundle byte stream contains
  `_blank` and `noopener noreferrer`.
- `tests/smoke.test.ts` fetching `GET /main.js` from the live server and
  asserting the same tokens.

The full bundle was inspected manually (4.6 kb, `public/main.js`); contains
the literal string `_blank` set via property assignment and the literal
`noopener noreferrer` for the rel attribute.

## Check 5 — Test runs did not corrupt shared state

PASS. The Vitest suite uses `:memory:` SQLite by default; `tests/db.test.ts`
durability case creates a tmpdir DB and removes it in `afterEach`. The
smoke test uses a tmpdir DB via the `BOOKMARKS_DB` env override. No
deliverable files were written outside `.loom/baseline-1779002783-1/app/`:

```
$ git status --porcelain | grep -v -E '^.M orchestrator|^\?\? orchestrator/evaluation/analytics/'
(empty)
```

The pre-existing modifications under `orchestrator/` were present before
the build wave and are unrelated.

## Summary

| Check                          | Status   |
|--------------------------------|----------|
| 1. Build artifacts             | PASS     |
| 2. App starts                  | PASS     |
| 3. Endpoints respond           | PASS     |
| 4. UI screens render           | SKIPPED  |
| 5. State not corrupted         | PASS     |

Acceptance gates from `plan.md`:

- `npm start` boots from `./app/` and serves `GET /` + `GET /api/bookmarks` on `http://localhost:3000` — VERIFIED (used port 3032 to avoid collision; configurable via `PORT`)
- `npm test` is green from `./app/` — VERIFIED (48/48)
- All four user stories satisfied — VERIFIED (see test-report.md story coverage matrix)
- Workspace isolation — VERIFIED (no writes outside `app/` and tmpdirs)
