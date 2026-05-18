---
project: baseline-1779111523-1
phase: build
created: 2026-05-18
---

# Smoke report — baseline-1779111523-1

## 1. Install

`npm install` in `app/` succeeded:

```
added 194 packages, and audited 195 packages in 29s
```

`happy-dom` added later for DOM-based client.delete tests (1 package).

## 2. Test suite

`npm test` exits 0. All 40 assertions across 11 files pass.

```
 ✓ tests/routes.list.test.ts (3 tests) 31ms
 ✓ tests/routes.create.test.ts (6 tests) 40ms
 ✓ tests/persistence.restart.test.ts (2 tests) 56ms
 ✓ tests/validation.test.ts (6 tests) 2ms
 ✓ tests/repository.create.test.ts (3 tests) 11ms
 ✓ tests/routes.delete.test.ts (3 tests) 38ms
 ✓ tests/client.open.test.ts (4 tests) 2ms
 ✓ tests/repository.list.test.ts (2 tests) 7ms
 ✓ tests/client.render.test.ts (5 tests) 2ms
 ✓ tests/repository.delete.test.ts (2 tests) 8ms
 ✓ tests/client.delete.test.ts (4 tests) 4ms

 Test Files  11 passed (11)
      Tests  40 passed (40)
```

Coverage of the three required test homes (per `tests.md § Smoke`):

- `tests/repository.*` — repository.list, repository.create, repository.delete (7 tests)
- `tests/routes.*` — routes.list, routes.create, routes.delete (12 tests)
- `tests/client.*` — client.render, client.open, client.delete (13 tests)

Plus `validation.test.ts` (6) and `persistence.restart.test.ts` (2).

## 3. Boot-and-curl probe

`npm start` (PORT=3737, BOOKMARKS_DB_PATH=/tmp/smoke-bookmarks-*.sqlite)
built the client bundle (`public/app.js 4.9kb`) and bound the server.

- `GET /` → `200`, `content-type: text/html; charset=UTF-8`, body
  contains the `<script src="/public/app.js" defer></script>` tag.
- `GET /api/bookmarks` → `200 {"bookmarks":[]}`.
- `SIGTERM` → process exited cleanly.

## Verdict

PASS — every task in Review meets the smoke gate. Cards may transition
to Done.
