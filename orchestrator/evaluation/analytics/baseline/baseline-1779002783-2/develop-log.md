# Develop log — baseline-1779002783-2

## 2026-05-17 — Build start — pre-flight

Node v25.8.2 + npm 11.11.1 on PATH. `node-test` verification environment
confirmed: no GUI required, native module compilation (`better-sqlite3`)
permitted. Build phase lock acquired and released after board mutation
of T-001 Backlog → In Progress.

## 2026-05-17 — T-001 green

Scaffolded `.loom/baseline-1779002783-2/app/`: `package.json` (express
4.21, better-sqlite3 11.3, vitest 2.1, esbuild 0.23, tsx 4.19, happy-dom
15.7), `tsconfig.json` (server NodeNext + strict), `tsconfig.client.json`
(ESNext / Bundler, `noEmit`), `scripts/build-client.mjs` (esbuild + mtime
idempotence per ADR-008), `vitest.config.ts` (happy-dom env),
`.gitignore`, `src/client/main.ts` stub, `tests/_init.test.ts`
placeholder. `npm install` succeeded (198 packages); `npm test` green
(1 passing); `node scripts/build-client.mjs` produced `public/bundle.js`
(392b). One attempt.

## 2026-05-17 — T-002 green

Storage layer: `src/server/db.ts` exposes `openDatabase` (path
precedence: explicit → `BOOKMARKS_DB` env → `./bookmarks.sqlite` rel.
cwd), `:memory:` accepted verbatim, WAL/foreign-keys/synchronous=NORMAL
pragmas. `migrate(db)` runs the schema verbatim with IF NOT EXISTS, both
indexes (`bookmarks_url_unique`, `bookmarks_created_at_idx`). 5 unit
tests pass; idempotence verified by snapshotting `sqlite_master`. One
attempt.

## 2026-05-17 — T-003 green

List slice: `repo/bookmarks.ts` adds `listBookmarks` (prepared
SELECT ORDER BY created_at DESC, id DESC) and `toApiShape`. `app.ts`
factory wires `express.json` (32kb limit), `express.static('public')`,
the bookmarks router under `/api/bookmarks`, and a 500 error
middleware. `routes/bookmarks.ts` exposes `GET /`. 2 integration + 3
repo tests. One attempt.

## 2026-05-17 — T-004 green

Create slice: `validate.ts` (URL trim + http(s) scheme + new URL parse
+ ≤2048; title trim + ≤512; `parseId` /^[1-9]\d*$/). `repo` extended
with `DuplicateUrlError` + `createBookmark` (catches
SQLITE_CONSTRAINT_UNIQUE). Route `POST /` handles 415 (non-JSON CT),
400 invalid_input (url|title), 409 duplicate_url, 201 success. 27
validate tests + 3 createBookmark repo tests + 6 integration POST
tests. One attempt.

## 2026-05-17 — T-005 green

Delete slice: `NotFoundError` + `deleteBookmark` (info.changes === 0 →
throw). Route `DELETE /:id` parses via `parseId` (400 invalid_id),
maps NotFoundError → 404, success → 204 empty. 2 repo tests + 4
integration tests. One attempt.

## 2026-05-17 — T-006 green

Shell + bootstrap: `public/index.html` minimal form + #error +
#bookmarks; `public/styles.css` hand-written. `src/client/render.ts`
uses textContent everywhere (`<img onerror>` injection produces zero
img children), anchors `target="_blank" rel="noopener noreferrer"`,
`span.url`, delete button `data-id`. `src/client/api.ts` maps non-2xx
to `ApiError(status, code, field?)`. `src/client/main.ts` shows
Loading… and refreshes the list. `src/server/index.ts` rebuilds the
client bundle when stale, opens DB, migrates, listens on 3000,
SIGINT/SIGTERM closes server + db. 8 render + 6 api tests. One attempt.

## 2026-05-17 — T-007 green

Form flow: `bindFormHandlers` listens to #new submit, calls
`createBookmark`, on 201 clears error + resets form + re-fetches; on
ApiError maps duplicate_url / invalid_input(url|title) / other / network
to user-facing copy. 5 happy-dom tests. One attempt.

## 2026-05-17 — T-008 green

Render finalisation: added the explicit
"server-authoritative-ordering — client does not re-sort" test
(US-002 AC-1) and an in-line comment. Red attempt deliberately broke
ordering via id-sort to drive an assertion failure; reverted to caller-
order iteration for green. One attempt.

## 2026-05-17 — T-009 green

Delete control: `bindDeleteHandlers` event-delegates clicks on
`button[data-id]` inside #bookmarks; on 204 clears error + re-fetches;
on 404 surfaces recovery message + re-fetches; on other / network
shows generic copy. 3 happy-dom tests. One attempt.

## 2026-05-17 — T-010 green

Smoke script: `scripts/smoke.mjs` mkdtemps a BOOKMARKS_DB path, spawns
the server twice with that env (cold + restart), asserts SQLite file
creation + POST/GET + restart persistence + DELETE cycle. `npm run
smoke` → `smoke: PASS`. One attempt.

## 2026-05-17 — smoke gate + test-report

`smoke-report.md` records PASS for build artifacts, app starts,
endpoints respond, shared state intact; SKIPPED with reason for
UI-screen rendering (covered by happy-dom under the plan-declared
`node-test` capability). `test-report.md` aggregates 76 vitest tests +
1 smoke pass + per-task + per-story coverage. All 10 tasks promoted
Review → Done.

## 2026-05-17 - baseline-1779002783-2 - review-pass-with-three-minors

Review verdict: PASS, 0 Blockers, 0 Major, 3 Minor, 1 Note. Local-only
Bookmarks app, 10 AFK tasks landed on attempt 1; 76 vitest assertions +
1 smoke pass; `npm run smoke` exercises the two-spawn restart cycle. All
10 ADRs honored, all 5 user stories (US-001..US-005) satisfied with
HTTP + DOM + smoke evidence. Stack matches the seed pin (express 4.21,
better-sqlite3 11.3, vitest 2.1, esbuild 0.23, tsx, typescript, supertest,
happy-dom). All deliverable writes confined to
`.loom/baseline-1779002783-2/app/`. Same-origin invariant held; no
outbound network calls; textContent everywhere; target=_blank always
paired with rel=noopener noreferrer.

Three Minor findings, none behavioural:

- M-1 (P1/P2): `client/main.ts` monkey-patches `url` onto an
  `ApiError` via intersection-type cast to thread the duplicate URL
  through the message formatter. `ApiError` class doesn't declare
  `url`. Either extend the class or use the form-input variable
  directly at the call site.
- M-2 (P5): `db.ts` runs `pragma('foreign_keys = ON')` but the
  schema has no foreign keys in any ADR. Speculative config with no
  current consumer.
- M-3 (P5/P1): `tests/_init.test.ts` placeholder remains after T-002
  added real tests that prove the harness works. Redundant.

Note N-1: `db.ts` enables `journal_mode = WAL` (also Note in the
baseline-1779002783-1 review). Not in design.md; sensible default,
worth promoting to design next baseline so the `.sqlite-wal/-shm`
sidecars are expected.

## 2026-05-17 - baseline-1779002783-2 - red-green-test-logs-restored

Per-task test-logs (`tasks/T-NNN.test-log.txt`) carry **both** a red
and a green phase for all 10 tasks this run. This addresses the M-3
gap from the previous baseline (baseline-1779002783-1), where logs
drifted to green-only summaries after T-002. T-001 records `vitest:
command not found` as the red substitute (no devDeps installed yet);
T-002..T-009 record assertion-failure outputs; T-010 records the
`scripts/smoke.mjs` ENOENT as the runtime substitute red. Pattern
worth keeping: when waves run serially inside one coordinator agent
the red fragment is cheap to capture if the agent dumps the failing
vitest output before re-running green.

## 2026-05-17 - baseline-1779002783-2 - happy-dom-fetch-chain-drain

The form-submit tests in `tests/unit/client/form.test.ts` drain the
awaited-fetch chain with two consecutive `await new Promise((r) =>
setTimeout(r, 0))` microtask hops, rather than `vi.runAllTimersAsync`
or fake timers. Clean and minimal for happy-dom + native `fetch` mocks
where the awaited chain is `fetch().then(json).then(refresh).then(get)`.
Worth promoting to client-side test guidance.
