---
project: baseline-1779002783-1
phase: build
created: 2026-05-17
---

# Develop Log — Bookmarks Build

## T-001 — Bootstrap ./app/ workspace
- Created `app/` skeleton, `package.json` with pinned deps (express, better-sqlite3, tsx, esbuild, vitest, supertest, typescript), `tsconfig.json` strict ES2022, `vitest.config.ts` with `passWithNoTests: true`, `.gitignore`.
- `npm install` succeeded in 51 s (better-sqlite3 prebuilt binary). `npm test` exit 0 with "No test files found".

## T-002 — SQLite persistence layer
- `src/server/db.ts`: `openDb(path)` returns `BookmarksRepo` with prepared statements (`listAll`, `insert`, `deleteById`, `close`), schema bootstrap, `DuplicateUrlError` (catches `SQLITE_CONSTRAINT_UNIQUE`), `NotFoundError` (changes===0). `created_at` set in JS at insert (`new Date().toISOString()`); ordering `created_at DESC, id DESC`.
- 6/6 tests green incl. file-backed round-trip via `os.tmpdir()`.

## T-003 — Validation helpers
- `src/server/validate.ts`: pure `validateBookmarkInput(raw)`. Trim title (≤500), URL must parse and be http/https; canonicalises via `new URL().toString()`.
- 8/8 tests green.

## T-004 — Express skeleton + error mapper
- `src/server/app.ts`: `buildApp(repo)` with `express.json()`, mounts `bookmarksRouter` at `/api/bookmarks`, `express.static(PUBLIC_DIR)`, 404 fallthrough, error mapper for `ValidationError` (400), `DuplicateUrlError` (409 with stable `error: "duplicate"` literal), `NotFoundError` (404), malformed JSON (400), catch-all (500 + console.error).
- `routes.ts` defines the router; T-005/6/7 implemented inline in the same wave because the test sketches all share `api.test.ts`. This is consistent with T-004 plan note "the goal is a wireable skeleton that T-005/6/7 plug into without restructuring."
- 3/3 skeleton subgroup tests green.

## T-005 — GET /api/bookmarks
- `router.get('/', (_req, res) => res.json(repo.listAll()))`. 2/2 tests green (empty list + newest-first).

## T-006 — POST /api/bookmarks
- Validates input, surfaces `ValidationError` on failure (mapped to 400), inserts and returns 201 on success. Duplicate URL → 409 via repo throw. 4/4 tests green.

## T-007 — DELETE /api/bookmarks/:id
- Regex `^[1-9]\d*$` gate on `:id`; non-matches fall through to 404 mapper. Missing rows throw `NotFoundError` → 404. Success → `res.status(204).end()`. 3/3 tests green.

## T-008 — Frontend bundle wiring
- `public/index.html` (form, error slot, root), `public/styles.css` (small CSS with `prefers-color-scheme`), `src/web/{api,render,main}.ts`. esbuild bundles to `public/main.js` (4.6 kb IIFE). `prestart` auto-builds.
- Out-of-scope addition: `jsdom` devDependency for DOM-based unit tests (consumer: tests/render.test.ts, tests/web-api.test.ts). Recorded per P5 in T-008.done.md.

## T-009 — Frontend list + empty state + open-in-new-tab
- `renderList` produces `<ul><li>` rows with `<a target="_blank" rel="noopener noreferrer">` (title via `textContent` → XSS-safe) and a `data-action="delete"` button. `renderEmptyState` renders the empty-state message.
- 7 render tests + 2 fetchBookmarks api tests + 1 bundle test green.

## T-010 — Frontend create form + inline error
- `createBookmark` maps 201/409/400/other to typed throws. `main.ts` submit handler clears + re-fetches on success, calls `renderInlineError` with the right message per failure kind, clears on `input` event.
- 4 createBookmark + 2 inline-error render tests green.

## T-011 — Frontend delete control + re-fetch
- `deleteBookmark` resolves on 204 / 404 (404 treated as benign), throws network otherwise. Delegated `click` handler on `#root` filters `data-action="delete"`, reads `data-id`, deletes, re-fetches.
- 3 deleteBookmark tests green.

## T-012 — npm start entrypoint + smoke
- `src/server/index.ts` opens `bookmarks.db` (override via `BOOKMARKS_DB`), binds `PORT` (default 3000), logs `listening on http://localhost:<port>`. Exits non-zero on throw.
- `tests/smoke.test.ts` spawns the server on port 3031 with a tmpdir DB, awaits the listening log, exercises GET /, GET /main.js, GET /api/bookmarks, POST + GET round-trip, DELETE; tears down cleanly.
- Manual `npm start` smoke (port 3032) verified `GET /` HTML, `GET /api/bookmarks` JSON `[]`, POST/GET round-trip; SIGTERM clean shutdown.

## Process notes / fallbacks
- The atomic-write.sh / locks.sh helpers were invoked but the in-context Build Coordinator dispatched waves serially within this single agent rather than spawning separate Task subagents (eval-harness execution model). Per-task discipline was preserved: lock acquire/release, separate test-log + done.md per ticket, board update at the end of each wave.

## Final stats
- 12/12 tasks green
- 7 test files, 48 tests, all passing
- Type-check clean
- `npm start` boots and serves; `npm test` exits 0
- Zero deliverable writes outside `.loom/baseline-1779002783-1/app/`

## 2026-05-17 - baseline-1779002783-1 - review-pass-with-minor-findings

Review verdict: PASS, 0 Blockers, 0 Major, 4 Minor, 1 Note. The 12-task
Bookmarks build landed cleanly inside `.loom/baseline-1779002783-1/app/`;
`git status` confirms zero deliverable writes outside the workspace (only
pre-existing `orchestrator/` modifications remain, unrelated to this
build). All 7 ADRs honored, all 5 seed decisions (Q01–Q05) observable in
the diff, all 4 user stories satisfied with HTTP + DOM + smoke evidence.
Stack matches the seed pin (express, better-sqlite3, tsx, esbuild, vitest,
supertest, typescript, jsdom); no frontend framework, no ORM, no
substitutions.

## 2026-05-17 - baseline-1779002783-1 - duplicated-network-error-branch

`src/web/main.ts` delete-click `catch` has an `if (isApiError(err) &&
err.kind === 'network') { renderInlineError(errorSlot, 'network error') }
else { renderInlineError(errorSlot, 'network error') }`. Both branches are
identical. P3 minor (dead duplication, ~5 lines). The submit handler in
the same file does the same renderInlineError pattern differently per
ApiError kind, which makes the delete handler's symmetry-implying shape
extra confusing for a reader. Trivial collapse to a single unconditional
call.

## 2026-05-17 - baseline-1779002783-1 - bookmark-type-redeclared

`src/web/api.ts` redeclares `Bookmark` and `BookmarkInput` instead of
importing them from `src/server/db.ts`. The `design.md` ADR-003 narrative
explicitly anticipated shared types ("`src/web/main.ts` plus its imports
… shared types from `src/server/db.ts`"), and `tsconfig.json`
`moduleResolution: Bundler` + `allowImportingTsExtensions: true` permit
the import. P3 minor (drift risk if the row shape evolves).

## 2026-05-17 - baseline-1779002783-1 - per-task-test-log-thinness

After T-002 the per-task test-logs (`T-004.test-log.txt` … `T-011.test-log.txt`)
became summary-only: green-phase result list with no captured red-phase
output. The review-phase spec requests red+green evidence per task so the
auditor can verify tests were not weakened to pass. Build process
follow-up: keep at least one failing assertion message or
module-not-found substitute in each task log even when waves are dispatched
serially inside a single Build Coordinator agent.

## 2026-05-17 - baseline-1779002783-1 - listen-error-path-not-captured

`src/server/index.ts` wraps `openDb` + `buildApp` + `app.listen` in a
synchronous try/catch. `app.listen` failures (EADDRINUSE in particular —
the most likely real-world failure for a local-only app) emit on the
server's `'error'` event asynchronously and are not caught by the wrap.
P1 minor; either attach `.on('error', err => { console.error(err);
process.exit(1) })` to the returned server, or drop the try/catch around
listen.

## 2026-05-17 - baseline-1779002783-1 - wal-journal-mode-undocumented

`src/server/db.ts` calls `db.pragma('journal_mode = WAL')`. Not named in
`design.md`. Harmless for a single-user single-process app and the
`.gitignore` already excludes `bookmarks.db-wal` / `-shm`; worth recording
since the next reviewer will see the journal files on disk.
