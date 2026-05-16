---
project: baseline-1778931123-1
phase: build
created: 2026-05-16
---

# Smoke Report — Bookmarks

Smoke gate per `weave/phases/build/methods/smoke.md`.

## Check 1 — Build artifacts complete

**PASS.** `tsx scripts/build-client.ts` produced `app/dist/client/`:

- `index.html` (references `/static/main.js` and `/static/styles.css`)
- `main.js` (esbuild ESM bundle, 5,551 bytes)
- `styles.css` (2,181 bytes)

Both the HTML shell and CSS are copied verbatim from `src/client/`. Required because TypeScript / esbuild do not auto-copy non-code assets.

## Check 2 — App starts successfully

**PASS.** `npx tsx src/server.ts` (the same command `npm start` invokes after the build step) prints `listening on http://localhost:3000` within ~1 second. No crash, no unhandled rejection, no migration error. The SQLite file `app/bookmarks.sqlite` is created on first boot via the idempotent `migrate()` call.

## Check 3 — Key endpoints respond

**PASS.** Probed against the running server:

| Probe | Result |
| --- | --- |
| `GET /` | `200`, `Content-Type: text/html; charset=UTF-8`, HTML shell with `/static/main.js` script tag |
| `GET /api/bookmarks` (cold) | `200 []` |
| `POST /api/bookmarks` `{url,title}` | `201` with `{id, url, title, created_at}` |
| `GET /api/bookmarks` (warm) | `200` containing the newly created bookmark |
| `GET /static/main.js` | `200`, 5,551 bytes |
| `GET /static/styles.css` | `200`, 2,181 bytes |
| `POST /api/bookmarks` duplicate | `409 {error.code: duplicate_url, field: url}` |
| `POST /api/bookmarks` `not-a-url` | `400 {error.code: validation, field: url}` |
| `DELETE /api/bookmarks/9999` | `404 {error.code: not_found}` |

Persistence smoke (US-005 & Constraints): post a bookmark → `pkill` the server → restart → `GET /api/bookmarks` returns the same row with the same `id` and `created_at`. **PASS.**

## Check 4 — UI screens render

**SKIPPED (with reason).** Per `tests.md ## Out of scope for tests` and `plan.md ## Verification environment`, link semantics are verified by asserting on rendered HTML / DOM produced by client unit tests in `jsdom`, not via a browser harness. The smoke HTTP probe of `GET /` confirms the shell HTML is served, and `client-render.test.ts` (jsdom) asserts that every anchor receives `target="_blank"` and `rel="noopener"`, that the empty-state branch fires when `bookmarks.length === 0`, and that titles/URLs are written via `textContent` (no `<script>` injection).

## Check 5 — Test runs did not corrupt shared state

**PASS.** The Vitest suite uses `:memory:` SQLite handles for unit and integration tests, and `node:os.tmpdir()` for the persistence smoke test. The production `app/bookmarks.sqlite` was created only by the explicit `npx tsx src/server.ts` smoke probe (Check 2) and was deleted after the probe finished. No fixture, config file, or other persistent artifact was modified by the test suite.

## Summary

5 checks: **4 PASS, 1 SKIPPED (rationale documented).** `npm test` from `app/` runs 9 files / 67 tests green in ~2.4s. `npm start` boots and serves both UI and API on `http://localhost:3000`. Persistence across restart confirmed end-to-end.
