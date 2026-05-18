## 2026-05-18 — baseline-1779088265-1 — Build Coordinator: pre-flight pass, T-001 promoted

Verification-environment pre-flight against `plan.md.Verification environment`: declared `node-test` (Vitest + supertest + jsdom, plus a `cli-shell` smoke gate). Coordinator harness can execute both — no `manual-browser-desktop` or GUI `headless-browser` dependency. Pre-flight passes; proceeding with the work loop.

Initial board state: 8 backlog tasks (T-001..T-008), nothing in `In Progress` / `Review` / `Done`. Only **T-001** has an empty `blocked-by` set — the other seven all transitively wait on it. No parallel batch is dispatchable in this dispatch cycle; the orchestrator will fan out T-002 + T-003 (and later T-004 + T-005) once their predecessors land.

Action this turn: acquired the project build lock, atomically rewrote `board.md` to move `T-001 Bootstrap workspace, tsconfigs, scripts, shared types` from `Backlog` to `In Progress`, released the lock. Returning control so `/weave` dispatches the Task Builder for T-001 — the Coordinator does not implement task scope itself.

## 2026-05-18 — baseline-1779088265-1 — T-001 Bootstrap workspace, tsconfigs, scripts, shared types — green on first attempt

Landed the foundation slice under `.loom/baseline-1779088265-1/app/`:

- `package.json` — `type: module`, `engines.node >=20`, pinned prod deps (`express` 4.21.0, `better-sqlite3` 11.3.0), pinned dev deps (`typescript` 5.6.2, `esbuild` 0.24.0, `vitest` 2.1.1, `supertest` 7.0.0, `jsdom` 25.0.1, `@types/express`, `@types/node`, `@types/supertest`, `@types/better-sqlite3`). Four scripts verbatim from Design § Constraints § Build: `build:client` (esbuild → `public/bundle.js`), `build:server` (`tsc -p tsconfig.json`), `start` (build client + server then `node dist/server/index.js`), `test` (`vitest run`).
- `tsconfig.json` — `NodeNext` / ES2022 / `strict`, `outDir: dist`, `rootDir: src`, `include: src/server/**, src/shared/**`.
- `tsconfig.client.json` — extends root, switches to `ESNext` / ES2020 + DOM libs, `moduleResolution: Bundler`, `noEmit: true` (esbuild owns the client emit), `include: src/client/**, src/shared/**`.
- `.gitignore` — `node_modules/`, `dist/`, `dist-client/`, `data/`, `public/bundle.js`.
- `src/shared/types.ts` — exports `Bookmark` (with camelCase `createdAt: number`), `CreateBookmarkInput`, `ApiErrorBody` per Design § Shared TypeScript types verbatim, plus a `SHARED_TYPES_READY` runtime sentinel so the type-only smoke test has a runtime witness (the task body explicitly calls for a smoke test that keeps Vitest from reporting "no tests found").
- `test/shared-types.test.ts` — single Vitest test that constructs values for each type via `satisfies` and asserts `SHARED_TYPES_READY === true`. Red phase: stubbed types module exported `SHARED_TYPES_READY = false`; vitest reported `AssertionError: expected false to be true`. Implementation flipped the sentinel and replaced the `unknown` aliases with the Design-pinned interfaces; tests green.

Acceptance gate evidence (all in `tasks/T-001.test-log.txt`):
1. `npm install` → exit 0 (230 packages).
2. `npx tsc -p tsconfig.json --noEmit` → exit 0.
3. `npx tsc -p tsconfig.client.json --noEmit` → exit 0.
4. `npm test` → 1 test, 1 passed.

No out-of-scope edits. T-001 ready for Review; T-002 and T-003 are now unblocked.

## 2026-05-18 — baseline-1779088265-1 — T-002 Open SQLite and run schema migration — green on first attempt

Landed `src/server/db.ts` per Design § Database factory / § SQLite schema:

- `openDb({ filename }): Database` — synchronous, returns the `better-sqlite3` handle directly. Wraps construction in a try/catch that rethrows `openDb: cannot open <filename>: <cause>` so AC4's "message references the path" holds (better-sqlite3's native ENOENT omits the path).
- Inline migration via `db.exec(SCHEMA_SQL)` — `CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at INTEGER NOT NULL)` and `CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at DESC, id DESC)`. Schema matches Design verbatim; idempotent by construction.
- Pragmas: `journal_mode = WAL` only when `filename !== ':memory:'`; `foreign_keys = ON` always.
- No `console`/stderr output (boot logging belongs to T-008).

`test/db.test.ts` covers all 6 acceptance criteria as behaviour checks via PRAGMA introspection + a UNIQUE-insert probe + a real on-disk temp file for the WAL + idempotency cases. Red phase: all 6 tests failed against the throwing stub (`Error: openDb not implemented`); one of them as a string-contains assertion error, the other five as the direct throw. Green phase: 6/6 pass.

Out-of-scope test file `test/app-factory.test.ts` (from another in-flight task) is currently red; left untouched per scope discipline. Acceptance evidence in `tasks/T-002.test-log.txt`.

T-002 ready for Review; T-004 / T-005 / T-007 (which import `openDb`) are now unblocked on the db side.

## 2026-05-18 — baseline-1779088265-1 — T-003 Express app factory with JSON middleware and error handler — green on first attempt

Landed the Express skeleton every later slice plugs into, per Design § App factory + § HTTP API + § State and error handling.

- `src/server/app.ts` — `createApp({ repo, staticDir }): Express`. Five middleware in fixed order: `express.json({ limit: '10kb' })` (Spec § Constraints § Security); `express.static(staticDir)` (serves `/` and `/public/*` per Design § HTTP API); `app.use('/api', createRoutes(repo))` (T-004 / T-005 / T-007 add handlers onto this router); a non-error 404 fallthrough returning `{ error: { code:'NOT_FOUND', message } }`; finally the error middleware mapping `DuplicateUrlError` → `409 { code:'DUPLICATE_URL', message }` and any other thrown error → `500 { code:'INTERNAL', message:'Internal error' }` with `console.error(err)`. No `.listen` — T-008 owns process boot.
- `src/server/routes.ts` — empty router shell exporting `createRoutes(repo)` returning `express.Router()`. The three bookmark handlers (`GET /bookmarks`, `POST /bookmarks`, `DELETE /bookmarks/:id`) land in the slice tasks onto this exact router.
- `src/server/bookmarks-repo.ts` — minimum landed by T-003 per the task notes: the `BookmarksRepo` interface and the `DuplicateUrlError extends Error` class (with `code = 'DUPLICATE_URL'` and a default message). The real repository (SQL against better-sqlite3) lands in T-004; T-003 needs only the class for the `instanceof` check in the error middleware and the type for `routes.ts` / `app.ts` to compile.

`test/app-factory.test.ts` (Vitest + supertest, 7 tests): app callable without `.listen`; `GET /api/unknown` → 404 envelope; `DuplicateUrlError` thrown by a route → 409 with code `DUPLICATE_URL`; arbitrary `Error` thrown by a route → 500 with code `INTERNAL`, `console.error` called once with the original error; `next()` with no error → 404 envelope; `GET /probe.txt` against a temp `staticDir` → 200 with file contents; missing static file → 404. The repo stub throws from every method to enforce T-003 must not call them.

A `mountBeforeFallthroughs` helper inside the test file splices test-only routes ahead of the final two middleware (404 + error) so they participate in the same error pipeline as the future slice handlers. Required because Express's catch-all 404 short-circuits anything registered onto `app` after `createApp` returns. The helper is test-file-only — no production hook.

Red phase: 5 runtime assertion failures (404 envelope missing, dup 500 vs 409, boom envelope missing, falls-through envelope missing, static probe 404 vs 200); 2 tests passed against the empty-Express stub (app callable + missing-static 404). No compile errors. Green phase: `tsc -p tsconfig.json --noEmit` → exit 0; `vitest run test/app-factory.test.ts` → 7/7 pass.

No new deps, no out-of-scope edits, no CORS/helmet/morgan per Design § Constraints § Libraries.

T-003 ready for Review; T-004 / T-005 / T-007 can now mount their handlers onto the `/api` router this task ships.

## 2026-05-18 — baseline-1779088265-1 — T-004 Save a bookmark end-to-end — green on first attempt

Vertical slice for US-001. Landed in three layers:

- `src/server/bookmarks-repo.ts` — `createBookmarksRepo(db)` returns the real `BookmarksRepo`: `insert` stamps `createdAt = Date.now()` and INSERTs / re-SELECTs through prepared statements, converting `SQLITE_CONSTRAINT_UNIQUE` into `DuplicateUrlError` (Design § State and error handling). `list` returns rows `ORDER BY created_at DESC, id DESC` (the compound order the T-002 index was built for). `deleteById` returns `info.changes > 0`. Snake-case row → camelCase `Bookmark` via a private `rowToBookmark` helper (Design § Shared TypeScript types).
- `src/server/routes.ts` — `POST /bookmarks` handler: inline `validateCreateInput` (object body, non-empty `url` + `title` strings, `new URL(url)` succeeds) → 400 `{ code: 'VALIDATION' }` on rejection, otherwise `repo.insert(...)` → 201 `{ bookmark }`. `DuplicateUrlError` propagates via `next(err)` into the T-003 error middleware → 409.
- `src/server/app.ts` — added a single 413 branch to the error middleware so `express.json`'s `entity.too.large` surfaces as 413 `PAYLOAD_TOO_LARGE` instead of being swallowed into 500 by the catch-all. Required by T-004 AC "Body > 10kb → 413 (from T-003 limit)" — the body-parser throws before any route handler runs, so the fix can only live in `app.ts`. Recorded under `out-of-scope-edits` in `tasks/T-004.done.md`.
- `src/client/api.ts` — `createBookmark(input)` POSTs JSON, parses `{bookmark}` on 201, otherwise throws `ApiError(message, code, status)` carrying the documented `{error: {code, message}}` envelope.
- `src/client/render.ts` — `renderFormError(root, message|null)` sets `root.textContent = message ?? ''`. One line; no `innerHTML` (Design § ADR-006).
- `src/client/form.ts` — `mountForm({form, errorRoot, onSaved})` exposes a `FormController` with a `state: 'idle' | 'submitting' | 'error'` field so tests can assert state transitions directly (P6 — behaviour on the public seam, no internal mocking). Imports `api` as a namespace so `vi.spyOn(api, 'createBookmark')` intercepts cleanly. Client-side `new URL(url)` validation short-circuits the empty/malformed-URL cases before any fetch; empty `title` falls through to the server (single source of truth for shape validation).

Tests landed: `test/repo.test.ts` (7), `test/routes-create.test.ts` (6), `test/client-form.test.ts` (4 under jsdom via the `// @vitest-environment jsdom` doc-comment). Red phase: 14/14 runtime assertion failures (`repo`/`mountForm` stubs threw, route POSTs returned 404 on the empty T-003 router, the 413 case returned 500 because the body-parser error fell through to the catch-all). No compile errors. Green phase: 17/17 pass; `tsc -p tsconfig.json --noEmit` exit 0; `tsc -p tsconfig.client.json --noEmit` exit 0. Other in-flight T-005 test files (`test/client-render.test.ts`, `test/routes-list.test.ts`) remain red as expected and were not touched.

No new deps. T-005 (list slice) and T-007 (delete slice) are now unblocked on the repo side.

## 2026-05-18 — baseline-1779088265-1 — T-005 List bookmarks newest-first end-to-end — green on first attempt

Vertical slice for US-002. Cuts repo → routes → client-api → client-render → empty-state.

- `src/server/routes.ts` — added `GET /bookmarks` handler ahead of the existing `POST`: `200 { bookmarks: repo.list() }`. `repo.list()` is synchronous (ADR-007), so no async wrapping; the global error middleware from T-003 handles any throw.
- `src/client/api.ts` — added `listBookmarks(): Promise<Bookmark[]>` mirroring the `createBookmark` shape (P2 prior art): `fetch('/api/bookmarks')`, parses `{bookmarks}` on 200, otherwise throws `ApiError` via the existing `throwApiError` helper.
- `src/client/render.ts` — added `renderList`, `renderEmptyState`, `loadAndRender`. Pure DOM via `document.createElement` + `textContent` + `setAttribute` (no `innerHTML`, enforcing ADR-006 / the cross-cutting no-innerHTML gate in `tests.md`). A shared private `clear(root)` helper removes every child before each render so the container holds exactly one state at a time (AC3 + the two state-swap tests). `loadAndRender` calls `api.listBookmarks` via `import * as api` so `vi.spyOn(api, 'listBookmarks')` intercepts on the public seam, matching the pattern T-004 established for `client-form.test.ts`. On rejection it swallows the error and renders an inline `[data-retry]` message (Design § Client-side state: "render an inline retry message; do not crash").

Each list entry is a `<li data-bookmark="<id>">` carrying `<span class="bookmark-title">` and `<span class="bookmark-url">`. The `<a target="_blank" rel="noopener noreferrer">` anchor that US-003 needs lands in T-006 onto this same `buildEntry` — T-005's assertions are on the `.bookmark-title` / `.bookmark-url` textContent, which are stable across that change.

Tests: appended a `bookmarks-repo.list` describe block (3 tests: distinct-`created_at` newest-first, same-ms higher-id-first tiebreak, empty DB → `[]`) to the existing `test/repo.test.ts`, did not touch the 4 insert tests T-004 ships. Added `test/routes-list.test.ts` (supertest against `createApp` with an in-memory repo: empty → `200 {bookmarks: []}`; seeded via `vi.setSystemTime` → newest-first body). Added `test/client-render.test.ts` (`// @vitest-environment jsdom`, 9 tests: `renderList` shape + order, the XSS textContent witness — render of `<script>alert(1)</script>` produces literal text and no `<script>` element, `renderEmptyState` shape, both state-swap directions, and `loadAndRender`'s three branches — resolved with rows, resolved with `[]`, rejected → inline retry without throwing).

Red phase: 11 runtime assertion/throw failures (8 stub throws in client-render, 2 `404 vs 200` in routes-list, plus 1 expected-but-now-resolved coverage line). No TypeScript compile errors at red. Green phase: full suite 42/42 pass; both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json --noEmit` exit 0.

No new deps, no out-of-scope edits. The `bookmarks-repo.ts` / `client/api.ts` / `client/render.ts` overlap with T-004 is intentional per `files-likely-touched` on both tasks; T-005 added only the list-side surface (`listBookmarks`, `renderList`, `renderEmptyState`, `loadAndRender`, `GET /bookmarks`) and did not modify the create-side surface. T-006 (open in new tab) and T-007 (delete) are now unblocked on the rendering surface.

## 2026-05-18 — baseline-1779088265-1 — T-006 Open a bookmark in a new tab — green on first attempt

Vertical slice for US-003. The single behaviour: each rendered bookmark is an `<a>` that opens its URL in a new tab with `rel="noopener noreferrer"`.

- `src/client/render.ts` — `buildEntry` now wraps the existing `.bookmark-title` + `.bookmark-url` spans inside an `<a>` carrying `href=bookmark.url` (via `setAttribute`, per AC4), `target="_blank"`, and `rel="noopener noreferrer"` (per AC2 / Spec § Constraints § Security invariant). No `onclick` is attached (AC3) — the anchor's native semantics carry the new-tab behaviour (AC1). Title and URL text still go through `textContent` only, so ADR-006 / the no-`innerHTML` gate from T-005's XSS test is preserved.
- `public/styles.css` — NEW. Static-layer artifact named in `files-likely-touched`. Provides `display:block` on `[data-bookmark] > a` so each row is one click target, `:hover` background, and `:focus-visible` outline so keyboard activation is visible (supports US-003 AC1 for keyboard users). Pure CSS, no JS.

Tests: extended `test/client-render.test.ts` in place with a new `describe('anchor attributes (T-006 / US-003)')` containing three behaviour-level cases — (1) the anchor exists and `href` / `target` / `rel` (split on whitespace) match exactly; (2) `javascript:alert(1)` round-trips through `href` verbatim, documenting that T-006 owns attributes only and T-004 owns the URL gate; (3) no element under root has an `onclick` handler. The existing 9 T-005 tests still pass against the new `<a>` wrapper because they assert on `[data-bookmark]` / `.bookmark-title` / `.bookmark-url`, which were preserved.

Red phase: 2 runtime assertion failures (both `root.querySelector('a') is null`); the no-`onclick` test passed at red because the prior `buildEntry` had no `onclick` — it stays as a regression gate. Compile clean at red.

Green phase: full suite 45/45 pass; `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json --noEmit` both exit 0.

No new deps, no out-of-scope edits. Artifacts: `tasks/T-006.done.md`, `tasks/T-006.test-log.txt`. T-007 (delete slice) and T-008 are unblocked on the rendering surface.

## 2026-05-18 — baseline-1779088265-1 — T-007 Delete a bookmark end-to-end — green on first attempt

Vertical slice for US-004. Wires delete from the DOM click all the way to SQLite across repo, routes, client-api, and client-render.

- `src/server/routes.ts` — registered `DELETE /bookmarks/:id` on the same Router as `POST` / `GET`. Validates `req.params.id` with `/^-?\d+$/.test` + `Number.isInteger` so `not-an-int`, `1.5`, and `1e2` all return `400 {error: {code: 'BAD_ID', message}}`. Any integer id calls `repo.deleteById(id)` and returns `204` regardless of whether a row was removed — ADR-005's idempotency contract. No try/catch around the repo call: `deleteById` is synchronous and never throws on a missing row (its documented contract, re-asserted by the new repo tests).
- `src/client/api.ts` — added `deleteBookmark(id: number): Promise<void>`. Mirrors `listBookmarks` / `createBookmark`: `fetch`, status guard against `204`, `throwApiError` on the non-success branch so the same `ApiError` surface lights up on misconfiguration (P2: match prior art).
- `src/client/render.ts` — extended `buildEntry` with a sibling `<button type="button" data-delete-for="<id>" aria-label="Delete bookmark <title>">` after the existing `<a>` anchor. Click handler calls `api.deleteBookmark(id)` then `loadAndRender(root)`, using the same `import * as api` namespace pattern the list + form code already uses so `vi.spyOn` intercepts both calls in jsdom. `buildEntry` now takes `root` so the entry can trigger a re-render; private to the module, no external callers.

Tests: added a `bookmarks-repo.deleteById` describe block in `test/repo.test.ts` (3 cases: insert → deleteById → list empty + true return; `deleteById(99999)` returns false without throwing; delete-then-reinsert same URL succeeds with a different id). Added `test/routes-delete.test.ts` (5 supertest cases: AC1 happy path with body absence + GET excludes the row, AC3 repeated delete still 204, AC3 never-existed id 204 with survivors unchanged and no `console.error`, AC2 delete + same-URL POST → 201, Negative `/not-an-int` → 400 `BAD_ID`). Extended `test/client-render.test.ts` with a `delete control (T-007 / US-004)` describe block (2 cases: shape — one `button[data-delete-for]` per row with `type=button` and an aria-label containing the title; behaviour — stub `deleteBookmark` + `listBookmarks`, click the b1 button, assert `deleteBookmark(b1.id)` then `listBookmarks` was called then b1's `[data-bookmark]` is gone and b2's remains).

Red phase: 7 runtime assertion failures (5 status 404 vs 204/400 in routes-delete, 1 `expected length 2 got 0` and 1 `Cannot read properties of null (reading 'dispatchEvent')` in client-render). No TypeScript compile errors at red. Green phase: full suite 55/55 pass; both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.client.json --noEmit` exit 0.

No new deps, no out-of-scope edits. The repo `deleteById` overlap with T-004 is intentional per `files-likely-touched` on both tasks — same footnote as T-005 for `list()`; T-007's repo tests pass on first run because the data-access primitive was already on disk, and they remain because they encode T-007's repo-layer acceptance gate. Artifacts: `tasks/T-007.done.md`, `tasks/T-007.test-log.txt`. T-008 (runtime entrypoint) is now the remaining task.

## 2026-05-18 — baseline-1779088265-1 — T-008 Boot process, static shell, smoke gate — green on first attempt

Final task. Closes the `npm start` / `npm test` contract by landing the runtime entrypoint, the static HTML shell, the client boot, and the end-to-end smoke gate from `tests.md`.

- `src/server/index.ts` (NEW) — runtime entrypoint. Resolves paths next to the compiled server via `fileURLToPath(import.meta.url)` (the file lives at `dist/server/index.js`, so `appRoot = ../..` of `here`). Reads `DATA_DIR` and `PORT` from env (defaults: `./data` and `3000`), `mkdirSync(dataDir, {recursive: true})`, calls `openDb({filename: <dataDir>/bookmarks.db})`, builds the repo, builds `createApp({repo, staticDir: <appRoot>/public})`, calls `.listen(port)`. On `mkdir` / `openDb` throw, writes the failing path to stderr and `process.exit(1)` — AC5. Single steady-state log line `Bookmarks listening on http://localhost:<port>` from the `.listen` callback (T-008 notes).
- `src/client/main.ts` (NEW) — on `DOMContentLoaded` (or immediately if past loading), grabs `#save-form` / `#form-error` / `#list-root`, throws if any are missing, calls `mountForm` with an `onSaved` callback that triggers `loadAndRender(listRoot)`, and calls `loadAndRender(listRoot)` once for the initial paint. Named imports from `form.ts` and `render.ts` (matching the rest of the client surface).
- `public/index.html` (NEW) — hand-written ~25-line shell. `<!doctype html>`, `<meta charset>`, `<meta name="viewport">`, `<title>Bookmarks</title>`, `<link rel="stylesheet" href="/styles.css">`, a `<form id="save-form">` with `name="url"` + `name="title"` inputs and a submit button, a `<div id="form-error" role="alert" aria-live="polite">` region, a `<div id="list-root">` container, and a `<script type="module" src="/bundle.js">` tag. ARIA `role="alert"` + `aria-live="polite"` so the inline server error message from US-001 AC2 is announced to screen readers without rebuilding the element.
- `public/styles.css` — extended in place with `:root` light tokens (`--bg`, `--fg`, `--muted`, `--border`, `--row-hover`, `--accent`, `color-scheme: light`), a single `@media (prefers-color-scheme: dark)` block overriding the same tokens and flipping `color-scheme: dark`, and form / form-error / delete-button rules consuming the tokens. T-006's `[data-bookmark]` anchor rules were preserved verbatim; the only edit there was the `:hover` background switching from a hard-coded `rgba` to `var(--row-hover)` so dark mode picks up the lighter overlay. Spec's "dark mode if it falls out of CSS for free" clause is satisfied without a toggle (AC6).

Tests: added `test/smoke.test.ts` (6 cases). The suite builds the client + server once in `beforeAll` so it exercises the same `dist/server/index.js` + `public/bundle.js` artifacts `npm start` produces. Spawns `node dist/server/index.js` with `DATA_DIR=<tmp>/<case>`, polls `127.0.0.1:3000`, kills via SIGTERM (escalating to SIGKILL after 2s) and waits for the port to release between cases. (1) Shell + bundle + stylesheet served; (2) the full create → list → delete → list round trip; (3) persistence across restarts — spawn, POST, kill, assert `<DATA_DIR>/bookmarks.db` exists, respawn, GET sees the row; (4) `DATA_DIR` set to a child of a regular file (so `mkdir -p` fails) → exit code ≠ 0 and stderr contains the bad `DATA_DIR` path (AC5); (5) `public/index.html` / `public/styles.css` shape — doctype, charset, viewport, stylesheet link, `type="module"` bundle script, and the `prefers-color-scheme: dark` media query (AC6); (6) the cross-cutting no-`innerHTML` grep over `src/client/**/*.ts` returns zero matches. The grep test passed at red — it was already true since T-005 — but lives in the smoke suite because the tests.md plan explicitly assigns cross-cutting non-functional gates here.

Red phase: 5 runtime assertion failures (3 `port :3000 not accepting` because the stub `index.ts` threw at module-load time before binding; 1 stderr-does-not-contain-badDataDir because the stub error said "not implemented"; 1 `<meta charset` not in stub HTML). One pre-existing-truth case passed at red as a regression gate. No TypeScript compile errors at red. Green phase: full suite 61/61 pass; smoke alone runs in under 5s after the one-shot build; both `tsc --noEmit` invocations exit 0.

No new deps. No files written outside the app workspace (smoke test puts every `DATA_DIR` under `os.tmpdir()` and cleans up in `afterAll`; the build emits to `./app/dist` and `./app/public/bundle.js` per `package.json` scripts; the existing `.gitignore` already covers `dist/`, `data/`, and `public/bundle.js`).

All eight tasks for baseline-1779088265-1 are now green. Artifacts: `tasks/T-008.done.md`, `tasks/T-008.test-log.txt`.

## 2026-05-18 — baseline-1779088265-1 — Build Coordinator — phase complete

All eight tasks reached `Done`. Aggregated verification:

- 61/61 Vitest cases pass across 10 files (`db`, `repo`, `app-factory`, `routes-create`, `routes-delete`, `routes-list`, `shared-types`, `client-form`, `client-render`, `smoke`). Duration 2.37s. Smoke alone ~2.1s.
- `tsc --noEmit` exits 0 for both `tsconfig.json` and `tsconfig.client.json`.
- Cross-cutting no-`innerHTML` grep over `src/client/**/*.ts` returns 0 matches.
- `tests.md § Smoke gate` 8/8 steps PASS: clean `data/`, `npm start` binds :3000, `GET /` → 200, `GET /api/bookmarks` → `{"bookmarks":[]}`, `POST /api/bookmarks` → 201 with the created bookmark body (id=1, createdAt=1779092876586), server killed cleanly, no writes outside `app/` beyond `data/bookmarks.db*` and `public/bundle.js`.
- Mutation gate skipped per `tests.md`: `Mutation Testing: no`.
- Verification env: plan declared `node-test` + `cli-shell`, both executable here. No `headless-browser` step required (UI gates covered via jsdom). Skipped a Chrome screenshot — Chrome not installed locally — but the plan-declared contract does not require it.

Pre-condition cleanup: an orphaned `node dist/server/index.js` (PID 78948, parented to init, ~18min old) was bound to :3000 from a prior T-008 run before this Coordinator dispatch. Killed before the smoke gate; the smoke test's `killServer` helper already escalates to SIGKILL so the test suite is robust against itself, but the prior orphan was outside that lifecycle. Also reaped one stale per-task lock (`.locks/T-002.lock`, PID 68819 dead, same host).

Artifacts written this dispatch: `smoke-report.md`, `test-report.md`, `board.md` (Review → Done for all 8 cards). All eight task `done.md` / `test-log.txt` files remain from prior task dispatches.

## 2026-05-18 — baseline-1779088265-1 — Review Audit Agent — phase complete (PASS)

Greenfield baseline run with an unusually tight Spec / Design / Plan triangle produced **8/8 tasks green on attempt 1, 61/61 Vitest cases (10 files), 8/8 smoke-gate steps**. Re-ran `npm test` from inside `app/` during review to verify build-phase numbers: 61 passed / 0 failed in 7.48s. Smoke + persistence + workspace-isolation gates re-checked PASS.

Principle walk (P1..P7 of `orchestrator/principles.md`) raised **zero Blocker- and zero Major-severity findings**. The review surfaced five Notes only:

1. Strong template alignment — every `T-NNN.satisfies-stories` field maps to a Spec acceptance criterion with no orphans. Useful as a clean-signal reference run for `/tune` calibration.
2. Source code comments reference Forge artifacts (`T-NNN`, `ADR-NNN`, `US-NNN`, `Spec §`, `Design §`) — 13 hits across 7 files. Violates user-memory rule `feedback_comment_style.md` ("NEVER reference Forge artifacts in code"). Not pinned in this project's `spec.md ## Constraints`, so the severity-mapping rule keeps it as a Note for `/tune build` to curate.
3. `_`-prefix unused params (`_req`, `_next`) in Express middleware signatures — violates user-memory rule `feedback_naming_and_formatting.md`. Express's error-middleware four-arg signature partially forces this; Note only.
4. `SHARED_TYPES_READY = true` sentinel constant in `src/shared/types.ts` is consumed only by the foundation test — borderline P5 (no speculative scaffolding). Could be replaced by a type-only `satisfies` test.
5. Pre-existing orphan `node dist/server/index.js` on `:3000` before the smoke run; the smoke test's `killServer` handles within-run lifecycle but not stale hosts. Smoke could harden by opportunistically freeing `:3000` in `beforeAll` or randomising the port.

Dual-write check passed: every `## YYYY-MM-DD — baseline-1779088265-1 — …` heading in `develop-log.md` has a matching heading in `orchestrator/log/build.md` for the build-phase entries. This Review-phase observation is dual-written to `orchestrator/log/audit.md`.

Artifacts: `review.md`, `review-verdict.json` (`{verdict: "PASS", blockers: 0, major: 0, minor: 0, note: 5}`).
