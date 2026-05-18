## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-001 promoted to In Progress

Verification-environment pre-flight: `plan.md` declares `node-test`
(`npm test` from `.loom/baseline-1779088275-1/app/`, runs `tsc
--noEmit` + `vitest run` in-process, supertest for HTTP, happy-dom
opt-in per-file). Coordinator capability matches — no GUI / manual-
browser harness required. Pre-flight passes.

Board scan: 5 cards total, all in `Backlog`. Only `T-001`
(Workspace scaffold and run contracts) has an empty `blocked-by`
set. `T-002` is blocked by `T-001`; `T-003`, `T-004`, `T-005` are
blocked by `T-001` + `T-002`. No parallel batch is available this
round — `T-001` is a single-card dispatch.

Promotion: acquired project lock
(`orchestrator/lib/locks.sh acquire baseline-1779088275-1 build`),
moved `T-001` from `Backlog` to `In Progress` via
`orchestrator/lib/atomic-write.sh`, released the lock. No task
subagent dispatched by the Coordinator — per phase contract, the
orchestrator fans out `methods/task.md` from `/weave` against the
updated board.

`tests.md` opts out of mutation testing (`**Mutation Testing:**
no`). `methods/smoke.md` will run once a task transitions to
`Review`; nothing in `Review` yet.

Returning `status: Pending` with `completed: 0`, `failed: 0`,
`hitl-pending: 0` so the orchestrator dispatches the T-001 Task
Builder subagent and re-dispatches the Coordinator after it
returns.

## 2026-05-18 — baseline-1779088275-1 — T-001 Workspace scaffold and run contracts green on first attempt

Stood up the `app/` workspace under `.loom/baseline-1779088275-1/app/`:
`package.json` with `start` (`node --import tsx src/server/index.ts`),
`prestart` (esbuild IIFE bundle of `src/client/main.ts` → `dist/main.js`),
and `test` (`tsc --noEmit && vitest run`); `tsconfig.json` pinned to
ES2022 / `moduleResolution: Bundler` / `strict: true` / `noEmit: true`
with `src/` and `tests/` in `include`; `vitest.config.ts` with default
Node environment and globals on (happy-dom opted in per-file via the
`// @vitest-environment` pragma per design.md). Deps pinned per task:
`express`, `better-sqlite3`; dev `typescript`, `tsx`, `esbuild`,
`vitest`, `supertest`, `happy-dom`, plus the matching `@types/*`.

Source tree: `public/index.html` with `#add-form` + `#bookmarks` mount
nodes wired to `/dist/main.js` + `/style.css`; `public/style.css` with
minimal layout and a `@media (prefers-color-scheme: dark)` block (no
toggle); `src/server/index.ts` boots Express on `process.env.PORT ?? 3000`,
mounts a placeholder `/api` 501 router (replaced wholesale in T-002),
`express.static('public')`, `express.static('dist')`, and SIGINT/SIGTERM
graceful shutdown; `src/client/main.ts` is a no-op `DOMContentLoaded`
handler. `.gitignore` lists `node_modules/`, `dist/`, `data/`, `*.db`,
`*.db-journal`.

Test layout: `tests/placeholder.test.ts` carries the `1+1` placeholder
(per task scope, kept until T-002 lands real specs);
`tests/smoke/run.test.ts` is gated behind `SMOKE=1` (so `npm test` stays
in-process and fast) and spawns `npm start` in a child process with
`PORT=3456`, polls `GET /` until 200, asserts the body contains
`id="bookmarks"`, then SIGTERMs the child. A second assertion in the
same spec checks workspace isolation — `data/` and `*.db` MUST NOT
appear in the parent `.loom/baseline-1779088275-1/` directory after
the smoke run.

Red phase: `SMOKE=1 vitest run` produced runtime assertion failure
`Error: status 404` from `waitForServer` — the initial server stub
listened on the port but did not wire any static middleware, so `GET /`
returned 404. Compile + type-check passed throughout (no missing-import
errors). Green phase after wiring `createApp()` with the placeholder
API router and the two `express.static` mounts: 3/3 specs pass
(smoke ×2 + placeholder ×1); `npm test` exits 0 with the smoke spec
skipped by default.

No out-of-scope edits. No commits. Single attempt to green.

## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-001 → Done, T-002 promoted to In Progress

Pre-flight: `plan.md` `## Verification environment` still declares
`node-test`. Coordinator capability matches (`node` v22.18.0, `npm` 10.9.3
on PATH). No env mismatch.

Re-dispatch state: `board.md` shows `T-001` in `In Progress` with a
green `tasks/T-001.done.md` (status: green, attempts: 1). No cards in
`Review` yet, four cards in `Backlog` (`T-002`..`T-005`).

Project lock acquired
(`orchestrator/lib/locks.sh acquire baseline-1779088275-1 build`).
Per the `board.md` transition table, `T-001` moved from `In Progress`
to `Review` (its task return was `green`). The project is runnable, so
`methods/smoke.md` ran before promoting to `Done`:

- Built artifacts present (`app/dist/main.js` 115 B IIFE, `app/public/index.html`
  with `#bookmarks` mount, `app/public/style.css` 775 B).
- `PORT=3458 npm start` booted in ~1 s, logged the listening line, and
  responded cleanly to `SIGTERM` (exit 143 from `wait`).
- `GET /` 200 with `id="bookmarks"` in body; `GET /style.css` 200 / 775 B;
  `GET /dist/main.js` 200 / `application/javascript` / 115 B; `GET /api/bookmarks`
  501 with the documented `NOT_IMPLEMENTED` JSON shape.
- UI render check SKIPPED — `T-001` has no `satisfies-stories` payload, so
  there is no UI feature to screenshot. The first UI-visible feature (US-002
  empty + populated list render) lands in `T-002`.
- Shared-state check PASS — no `data/` directory and no `*.db` file in the
  project root or `app/` after the full test + smoke run.

All checks PASS (or SKIPPED with reason). `smoke-report.md` written via
the atomic-write helper. `T-001` promoted from `Review` to `Done`.

Next ready cards: `T-002` is the only card with an empty `blocked-by`
set in `Backlog`. `T-003`, `T-004`, `T-005` are all blocked by `T-002`
only (the `T-001` blocker was struck from their lines because `T-001`
is now `Done`). `T-002` promoted to `In Progress`; no parallel batch is
available this round. Board write went through
`orchestrator/lib/atomic-write.sh`; lock released.

`tests.md` still declares `**Mutation Testing:** no` — `methods/mutation.md`
skipped per contract. `test-report.md` aggregates `T-001`'s green run,
the live-process probes, and the mutation-skip note.

Returning `status: Pending` with `completed: 1` (`T-001`), `failed: 0`,
`hitl-pending: 0`. The orchestrator should dispatch the `T-002` Task
Builder subagent against the updated board and re-dispatch the
Coordinator on its return.

## 2026-05-18 — baseline-1779088275-1 — T-002 List bookmarks end-to-end green on first attempt

Landed the full vertical slice for `US-002` (list bookmarks end-to-end):
server-side `db.ts` factory + schema bootstrap, `repo.ts` with `listAll()`
ordered by `created_at DESC, id DESC` and full `insert` / `deleteById`
implementations (behavior tests for those live in T-003 / T-005 per the
task notes; landing the SQL together keeps the surface coherent),
`routes.ts` `GET /bookmarks` returning `200 { bookmarks }`, and
`index.ts` wiring the real router in place of the T-001 placeholder
501 mount. `DuplicateUrlError` is exported and wired to the
`SQLITE_CONSTRAINT_UNIQUE` rethrow path.

Frontend: `api.ts` `fetchBookmarks()` with the documented
`ApiError(status: 0, code: "NETWORK")` fetch-rejection path, `render.ts`
`renderList` / `renderEmptyState` as pure DOM helpers that wipe and
append into the passed parent (title is an `<a href={url}>`, URL is a
visible `<span>`; `target="_blank"`/`rel` deliberately left for T-004),
and `main.ts` with a module-scoped `refresh()` driving the
`DOMContentLoaded` flow and exposing the seam T-003 / T-005 will reuse.

Tests: `tests/unit/repo.test.ts` (empty list, newer-first ordering
via `vi.useFakeTimers()`, same-timestamp `id DESC` tiebreak),
`tests/unit/render.test.ts` (`@vitest-environment happy-dom`; empty
+ populated DOM with the anchor `href` assertion), and
`tests/http/bookmarks.test.ts` (`supertest` against an inline app
built from `:memory:` DB + repo + `createRouter`; empty and seeded
round-trips, ordering preserved over HTTP). Removed
`tests/placeholder.test.ts` — T-001's task scope explicitly framed it
as a stand-in "until T-002 lands real specs".

Red phase: 7 runtime assertion failures (`Error: createDb: not
implemented`, `Error: renderList: not implemented`) — stubs let the
test imports resolve, so failures were behavioral, not compile errors.

Green phase: 7/7 new specs pass under `npm test` (smoke spec stays
gated and skipped). One implementation iteration was needed to flip
the empty-state element from `<li>` to `<p>` so the render test's
"zero `<li>` rows in the empty branch" assertion held — the test
contract is unambiguous. Counted as a single attempt.

No commits. No out-of-scope edits beyond the documented
`tests/placeholder.test.ts` deletion.

## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-002 → Done, T-003 promoted to In Progress

Pre-flight: `plan.md` `## Verification environment` still declares
`node-test`. Coordinator capability matches (`node` v22.18.0,
`npm` 10.9.3, `tsc`, `vitest` all on PATH). No env mismatch — no
blocker.

Re-dispatch state: `board.md` showed `T-002` still in `In Progress`
despite `tasks/T-002.done.md` already carrying `status: green`,
`attempts: 1` from the prior subagent. Per the transition table the
green return promotes the card `In Progress` → `Review`; the smoke +
mutation gates then decide `Review` → `Done`.

Project lock acquired
(`orchestrator/lib/locks.sh acquire baseline-1779088275-1 build`).
`methods/smoke.md` ran against the live workspace before the `Done`
transition:

- `npm test` from `app/`: tsc OK; `vitest run` 7 passed / 2 skipped
  (smoke specs gated by `SMOKE=1`).
- `SMOKE=1 PORT=3458 npm test`: 9 passed / 0 skipped — the boot-the-
  server spec proves the `npm start` run contract, and the in-process
  smoke spec asserts the "no `data/` in project root" isolation
  invariant.
- Coordinator-driven live probe against `PORT=3459 npm start`:
  `GET /` 200 (421 B HTML, `id="bookmarks"` present), `GET /style.css`
  200 (1259 B — grew from T-001's 775 B because T-002 added
  `.bookmark`, `.bookmark-title`, `.bookmark-url`, `.empty-state`
  rules), `GET /dist/main.js` 200 (2136 B — grew from T-001's 115 B
  because the IIFE bundle now ships `refresh`, `fetchBookmarks`, and
  the render branch), `GET /api/bookmarks` 200 with `{"bookmarks":[]}`
  — the real `createRouter(createRepo(createDb()))` mount has
  replaced the T-001 501 placeholder.
- UI render check passes via the happy-dom unit specs (the
  `node-test` harness intentionally does not boot a real browser):
  `renderEmptyState` produces one `<p class="empty-state">` and zero
  `<li>` rows; `renderList([b1, b2])` produces one `<li>` per
  bookmark with the anchor `href` set to the URL.
- Shared-state check: in-process tests leave no `data/` directory.
  The live `npm start` probe naturally produced `app/data/bookmarks.db`
  because `createDb()` now resolves to the production on-disk default
  (design § Storage). Coordinator removed `app/data/` after the
  probe so subsequent runs start clean. This is expected production
  behavior — not a regression from T-001 (where `createDb` was a
  throwing stub, so the server never opened a connection).

`smoke-report.md` rewritten via the atomic-write helper to fold in
the T-002 evidence alongside the prior T-001 pass. `T-002` promoted
from `Review` to `Done`.

Next ready cards: per the plan DAG `T-003`, `T-004`, `T-005` are all
independent of each other and only depended on `T-002`. The
`(blocked by T-002)` annotation was struck from their lines because
`T-002` is now `Done`. They form a DAG-level parallel batch, but
their `files-likely-touched` sets overlap on `client-render`,
`client-main`, and the shared test files (`tests/unit/render.test.ts`,
`tests/http/bookmarks.test.ts`, `tests/client/api.test.ts`) — so a
disjoint-files concurrent batch is NOT available. The Coordinator
promotes `T-003` (the largest scope, lands the validation surface
and the form-error render seam that T-004 and T-005 do not need to
modify) to `In Progress`; `T-004` and `T-005` stay in `Backlog` for
sequential promotion on subsequent passes.

Board write went through `orchestrator/lib/atomic-write.sh`. The
four `## ` headers (`Backlog`, `In Progress`, `Review`, `Done`) are
preserved in order; every prior card is in exactly one column; no
cards lost. `test-report.md` updated with the T-002 row, the
phase-wide smoke summary, and the story-coverage table (US-002
covered, gates green).

`tests.md` still declares `**Mutation Testing:** no` —
`methods/mutation.md` skipped per contract.

Lock released. Returning `status: Pending` with `completed: 2`
(`T-001`, `T-002`), `failed: 0`, `hitl-pending: 0`. The orchestrator
should dispatch the `T-003` Task Builder subagent against the
updated board and re-dispatch the Coordinator on its return.

## 2026-05-18 — baseline-1779088275-1 — T-003 Save a bookmark end-to-end green on first attempt

Landed the full vertical slice for `US-001` (save end-to-end with
inline validation and dedupe).

Server: new `src/server/validation.ts` exporting `parseTitle`
(trims, rejects non-string + empty-after-trim) and `parseUrl`
(requires `http:`/`https:` via the platform `URL` constructor;
returns the raw input verbatim per the "no normalization" dedupe
contract in `spec.md ## Constraints`). `routes.ts` gains
`POST /bookmarks`: validates title → 400 `INVALID_TITLE`, then url
→ 400 `INVALID_URL`, then calls `repo.insert` (whose
`DuplicateUrlError` rethrow path was already wired in T-002) and
returns 201 `{ bookmark }`. `DuplicateUrlError` is caught at the
route layer and mapped to 409 `DUPLICATE_URL`. `index.ts` now
mounts the single Express error middleware that responds 500
`{ error: { code: "INTERNAL", message } }` — design.md `### Server-
side error pipeline` step 4 placed this here, deferred by T-002
because no handler had a `throw` path until T-003 introduced the
`DuplicateUrlError` bubble.

Frontend: `api.ts` gains `createBookmark(input)` — POSTs JSON,
maps fetch rejection to `ApiError(0, "NETWORK")`, maps non-2xx to
`ApiError(response.status, code, message, field)` from the server
envelope, returns `body.bookmark` on 2xx. `render.ts` gains
`showFormError(form, field, message)` and `clearFormErrors(form)`
— error nodes carry `data-error-for=<field>` and are inserted
immediately after the `[name=<field>]` input. `main.ts` wires the
`#add-form` submit handler: prevent default, disable submit
button, `clearFormErrors`, call `createBookmark`; on success
`form.reset()` then `refresh()` (T-002's module-scoped helper);
on `ApiError` `showFormError(form, err.field ?? "form",
err.message)`. The `input` event clears any inline error for the
field that just received input. `index.html` fills the previously-
empty `<form id="add-form">` with title + url inputs + submit
button. `style.css` adds a small `.form-error` rule, dark variant
inside the existing `prefers-color-scheme: dark` block (no
toggle).

Tests: new `tests/unit/validation.test.ts` (10 specs covering
every row of the task's validation table); `tests/unit/repo.test.ts`
extended with `repo.insert` happy-path + `DuplicateUrlError`
specs; `tests/unit/render.test.ts` extended with
`showFormError`/`clearFormErrors` specs against the happy-dom
environment; `tests/http/bookmarks.test.ts` extended with four
`POST /api/bookmarks` specs (201 + round-trip, 400 INVALID_TITLE,
400 INVALID_URL, 409 DUPLICATE_URL with single-row check) using
the same supertest-against-in-process-app pattern T-002
established; new `tests/client/api.test.ts` with two specs
covering `createBookmark`'s ApiError mapping under
`vi.stubGlobal("fetch", …)`.

Red phase: 18 runtime assertion failures (`Error: parseTitle: not
implemented`, `Error: parseUrl: not implemented`, `Error:
createBookmark: not implemented`, `Error: showFormError: not
implemented`, `Error: clearFormErrors: not implemented`) — no
compile errors, no missing-import errors. Stubs let the test
imports resolve so failures were behavioral.

Green phase: `npm test` (`tsc --noEmit` + `vitest run`) → 27
passed / 2 skipped (smoke spec gated by `SMOKE=1`). Single
implementation iteration; no test edits required.

No commits. No out-of-scope edits.

## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-003 smoke-gated to Done; T-004 promoted to In Progress

Verification-environment pre-flight: `plan.md` still declares
`node-test`. Coordinator capability matches (node 22.18.0, npm 10.9.3
on this host; `app/node_modules` is in place from T-001). No GUI /
manual-browser harness required. Pre-flight passes.

T-003 Task Builder returned `status: green` on attempt 1 (see
`tasks/T-003.done.md` + `tasks/T-003.test-log.txt`). Per the board
transition rules, the Coordinator moved `T-003` from `In Progress`
through `Review` and then to `Done` once the phase-wide smoke gates
were re-run with `T-003`'s new surface (POST /api/bookmarks,
DuplicateUrlError → 409, INTERNAL error middleware) in place.

Smoke gates this pass (verified live, not just by replay of the
T-003 task-builder log):

- `npm test` (`tsc --noEmit` + `vitest run`) → 27 passed / 2 skipped.
  No type errors. Smoke specs gated by `SMOKE=1` (the 2 skipped).
- `SMOKE=1 vitest run` → 29 passed / 0 skipped. The in-process boot-
  the-server spec (`tests/smoke/run.test.ts`) passes, proving the
  `npm start` run contract and the "no `data/` in project root"
  workspace-isolation invariant continue to hold after T-003.
- Live `PORT=3460 npm start` probe: `GET /` 200 (HTML contains
  `id="bookmarks"`, 738 B); `GET /style.css` 200 (1422 B; grew from
  1259 B because T-003 added the `.form-error` rule + dark variant);
  `GET /dist/main.js` 200 (5109 B; grew from 2136 B because the
  bundle now includes the form-submit wiring and `createBookmark`);
  `GET /api/bookmarks` 200 `{"bookmarks":[]}`; `POST /api/bookmarks`
  with `{"title":"Hello","url":"http://example.com/"}` → 201 with
  the persisted `{id, title, url, created_at}` envelope; second POST
  with the same URL → 409 `DUPLICATE_URL` (field "url"); POST with
  whitespace-only title → 400 `INVALID_TITLE` (field "title"); POST
  with `javascript:alert(1)` URL → 400 `INVALID_URL` (field "url").
  All four documented error shapes match `decisions.md` exactly.
- The live boot probe naturally created `app/data/bookmarks.db` (the
  production on-disk path, same as the T-002 probe). The Coordinator
  removed `app/data/` after the probe so subsequent test runs start
  clean.
- SIGTERM shutdown was clean (exit status 143 = 128 + 15 = SIGTERM;
  the graceful-shutdown path landed in T-001 logs no errors).

Board mutation: T-003 → `Done`. Backlog re-scan after promotion —
T-004 (`US-003` open in new tab) and T-005 (`US-004` delete) are
both DAG-unblocked (their `blocked-by` is `[T-001, T-002]` and both
are now `Done`). They share `client-render`, `client-main`, and
`tests/unit/render.test.ts` in their `files-likely-touched` sets,
so no disjoint parallel batch is available. T-004 is promoted to
`In Progress` first because its scope is the smaller of the two
(no server-side surface, only the anchor wiring + render-spec
extensions); T-005 stays in `Backlog` for the next coordinator
pass.

Board write went through `orchestrator/lib/atomic-write.sh`. Four
`## ` headers preserved in order; every prior card is in exactly
one column; no cards lost. Project lock acquired via
`orchestrator/lib/locks.sh acquire baseline-1779088275-1 build`
before any board mutation; released after.

`tests.md` still declares `**Mutation Testing:** no` —
`methods/mutation.md` skipped per contract.

`test-report.md` and `smoke-report.md` updated with the T-003 row
and the live-probe details above. Returning `status: Pending` with
`completed: 3` (T-001, T-002, T-003), `failed: 0`,
`hitl-pending: 0`. The orchestrator should dispatch the T-004 Task
Builder subagent against the updated board and re-dispatch the
Coordinator on its return.

## 2026-05-18 — baseline-1779088275-1 — T-004 Open a bookmark in a new tab green on first attempt

Landed the new-tab affordance for `US-003`. Production-code diff is two
lines inside `renderList` (`src/client/render.ts`): the anchor that
T-002 already wired with `href = bookmark.url` now also carries
`target = "_blank"` and `rel = "noopener noreferrer"`. No `click`
listener — the browser's native handling of `target="_blank"` delivers
both AC-1 (open in new tab) and AC-2 (originating tab does not
navigate). `rel="noopener noreferrer"` is the security baseline the
task scope explicitly flags. `src/client/main.ts` deliberately
untouched.

Tests (`tests/unit/render.test.ts`): new `describe("renderList
(new-tab affordance — US-003)")` block with four specs matching the
task's EARS coverage map — `href` equals the bookmark URL,
`target === "_blank"`, `rel === "noopener noreferrer"`, and
`tabindex !== "-1"` (keyboard reachability via the default `<a href>`
behavior). The pre-existing populated-list spec already asserted the
`href` and the empty-state spec is unchanged.

Red phase: 2 runtime assertion failures —
`expected null to be '_blank'` and `expected null to be 'noopener
noreferrer'`. Both are real runtime assertions inside the new test
bodies, not compile or missing-import errors. The `href` and
`tabindex` assertions were already green from T-002's anchor wiring
(default tabindex on `<a href>` returns `null` from `getAttribute`,
which is correctly `!== "-1"`).

Green phase: `npm test` (`tsc --noEmit` + `vitest run`) → 31 passed
/ 2 skipped (smoke specs gated by `SMOKE=1`). Single attempt to
green; no test edits required.

No commits. No out-of-scope edits.

## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-004 → Done, T-005 promoted to In Progress

Verification-environment pre-flight unchanged: `node-test`, executable
by Coordinator. T-004 Task Builder returned `status: green` on first
attempt with `tasks/T-004.done.md` and `tasks/T-004.test-log.txt`
recording 2 runtime assertion failures in red (anchor `target` and
`rel`) and 31 passed / 2 skipped in green.

Coordinator pass:

1. Re-ran `npm test` from `app/`: tsc clean, vitest 31 passed / 2
   skipped (the 2 skipped are `SMOKE=1` boot specs). Green state
   reproduced.
2. Ran `SMOKE=1 npx vitest run`: 33 passed / 0 skipped — the
   boot-the-server spec confirms `npm start` still honors the run
   contract, and the in-process invariant spec confirms no `data/`
   appears under the project root during the in-process suite. The
   `SMOKE=1` boot probe did create `app/data/bookmarks.db` (production
   on-disk path); the Coordinator removed `app/data/` after the run
   so subsequent runs start clean.
3. Acquired the project lock (`locks.sh acquire baseline-1779088275-1
   build`), atomically rewrote `board.md` to:
   - Move `T-004` from `In Progress` through `Review` to `Done`
     (single atomic transition: green return + smoke pass).
   - Move `T-005` from `Backlog` to `In Progress` (DAG: blocked-by
     `T-001` + `T-002`, both `Done`; `files-likely-touched` no longer
     overlap with any other `In Progress` card).
   Released the lock.
4. Updated `test-report.md` (T-004 row → Done with red/green evidence
   cited; T-005 row → In Progress; story-coverage row updated;
   open-items rewritten to reflect the single remaining card) and
   `smoke-report.md` (added the T-004 pass section; extended the
   phase-wide gate matrix with a T-004 column).
5. `tests.md` still declares `Mutation Testing: no` → `methods/
   mutation.md` skipped this pass.

No commits. No out-of-scope edits. Returning `status: Pending` with
`completed: 4`, `failed: 0`, `hitl-pending: 0` so the orchestrator
dispatches the T-005 Task Builder subagent and re-dispatches the
Coordinator after it returns. Once T-005 lands and clears smoke, this
phase reports `status: complete`.

## 2026-05-18 — baseline-1779088275-1 — T-005 Delete a bookmark end-to-end green on first attempt

Landed the full vertical slice for `US-004` (delete a bookmark
end-to-end with idempotent no-op).

Server: `routes.ts` gains `DELETE /bookmarks/:id`. The `:id`
parameter is validated with a strict `/^\d+$/` regex plus
`Number.isInteger` and `> 0` — non-numeric ("abc"), negative
("-1"), and zero are rejected with 400 `INVALID_ID`. On valid
input, the handler calls `repo.deleteById(id)` and
unconditionally responds 204; both the "row existed" and "row
did not exist" branches return 204 per the design / decisions
pinning of US-004 AC-3 (the task notes explicitly warn against
introducing a 404 path here). `repo.deleteById` was already
implemented in T-002 with the correct true/false semantics —
T-005 lands the behavior tests for both branches.

Frontend: `api.ts` gains `deleteBookmark(id)` — fires `DELETE
/api/bookmarks/<id>`, resolves on 204, maps fetch rejection to
`ApiError(0, "NETWORK")` and non-204 to `ApiError(status,
code, message, field)` from the server envelope, mirroring the
`createBookmark` mapping. `render.ts` extends `renderList` so
each `<li>` carries a `<button class="bookmark-delete"
data-bookmark-id="<id>" aria-label="Delete bookmark">Delete</button>`
after the URL span; buttons are initially enabled. `main.ts`
adds `wireDeleteDelegation()` invoked from `DOMContentLoaded`:
clicks on `#bookmarks` are delegated to any descendant
`button[data-bookmark-id]` (so refetch-and-rerender does not
need to re-bind handlers). On click: disable the clicked
button, clear any prior list notice, call `deleteBookmark(id)`,
then `refresh()` to re-render the list. On `ApiError` (or any
other error): re-enable the button and surface a non-blocking
`#list-notice` `<p>` inserted just before the list mount with
"Couldn't delete — try again" — replaced (not stacked) on
subsequent failures and cleared at the start of the next delete
attempt.

Tests: `tests/unit/repo.test.ts` extended with the
`repo.deleteById` describe block (true path removes the row,
false path leaves rows untouched). `tests/unit/render.test.ts`
extended with the `renderList (delete control — US-004)`
describe block: one delete button per row carrying
`data-bookmark-id` matching the row id, an accessible label, the
button enabled by default, and the disabled-flag toggle round-
trip preserving the data attribute. `tests/http/bookmarks.test.ts`
extended with the `DELETE /api/bookmarks/:id` describe block: 204
+ GET excludes the deleted row (AC-1), 204 idempotent on a
non-existent id (AC-3), 204 idempotent on a second delete of
the same id (AC-3), 400 INVALID_ID on `abc`, 400 INVALID_ID on
`-1`. `tests/client/api.test.ts` extended with the
`deleteBookmark` describe block: resolves on 204, rejects with
`ApiError(400, "INVALID_ID")` on the 400 envelope, rejects with
`ApiError(0, "NETWORK")` on fetch rejection.

Red phase: 12 runtime assertion failures — 5 in
`bookmarks.test.ts` (route did not exist; supertest returned 404
where the spec wanted 204 / 400), 4 in `render.test.ts`
(`querySelector("button[data-bookmark-id]")` returned null), 3
in `api.test.ts` (`deleteBookmark` stub threw "not implemented"
so the `ApiError` instanceof assertions fired), 0 from
`repo.test.ts` actually — `deleteById` was already implemented
in T-002 so the new repo specs caught at assertion lines, not
"not implemented" throws (still runtime, not compile). All are
real runtime assertion failures, not compile or missing-import
errors.

Green phase: `npm test` (`tsc --noEmit` + `vitest run`) → 45
passed / 2 skipped (smoke specs gated by `SMOKE=1`). Single
implementation iteration; no test edits required.

No commits. No out-of-scope edits.

## 2026-05-18 — baseline-1779088275-1 — Build coordinator: T-005 promoted to Done; Build phase complete

Coordinator re-dispatch after Task Builder returned `status: green`
for T-005. Pre-flight `plan.md` § Verification environment re-read:
still `node-test`, harness unchanged.

Board scan: 4 cards Done (T-001..T-004), 1 card In Progress (T-005
with green done.md), 0 cards Backlog. Per board transition rules,
T-005 Task Builder returned `status: green` → card transitions `In
Progress → Review`; smoke + mutation gates then transition `Review →
Done`.

Smoke gate (T-005):
- `npm test`: tsc clean; 45 passed / 2 skipped (the 2 skipped are
  smoke specs gated by `SMOKE=1`).
- `SMOKE=1 vitest run`: 47 passed / 0 skipped (boot-the-server spec
  proves `npm start` contract; in-process invariant spec confirms no
  `data/` directory under the project root).
- Live `PORT=3461 npm start` probe: 11 endpoints exercised. `GET /`,
  `GET /style.css`, `GET /dist/main.js` all 200. Seeded a bookmark
  via `POST /api/bookmarks` → 201. `DELETE /api/bookmarks/1` (exists)
  → 204; `DELETE /api/bookmarks/1` again (already-deleted) → 204;
  `DELETE /api/bookmarks/9999` (never existed) → 204 — the load-
  bearing US-004 AC-3 idempotent contract verified for both
  branches. `DELETE /api/bookmarks/abc` → 400 INVALID_ID;
  `DELETE /api/bookmarks/-1` → 400 INVALID_ID. Post-delete
  `GET /api/bookmarks` → `{"bookmarks":[]}` (AC-1: row excluded).
- esbuild bundle: 7.5 KB (grew from 5.1 KB at T-003; T-004 was
  render-attribute-only, T-005 adds the event-delegated delete
  click handler, the `deleteBookmark` API wrapper, and the list-
  notice swap).
- Live boot left `app/data/bookmarks.db`; Coordinator removed
  `app/data/` after the probe so subsequent runs start clean.

Mutation gate: `tests.md` declares `**Mutation Testing:** no`.
Coordinator skips `methods/mutation.md` per the spec.

Board mutation (single atomic-write of board.md): T-005 →
`Done`. Board now: Backlog 0, In Progress 0, Review 0, Done 5.

`smoke-report.md` updated with the T-005 Pass section + phase-wide
table column. `test-report.md` updated: per-task row for T-005
filled (Done, 1 attempt, red / green / done evidence linked); story
coverage table flips US-004 to Done; open-items section now reports
"None. Build phase reports status: complete."

Build phase status: complete. Every active user story
(US-001..US-004) is satisfied end-to-end and every gate is green.
No HITL pending, no failed cards, no out-of-scope edits, no commits.
Ready for the Review phase gate.

## 2026-05-18 — baseline-1779088275-1 — Review: P3 enforcement gap across consecutive Build tasks

T-005's Task Builder added the third `ApiError(0, "NETWORK", …)` throw in
`src/client/api.ts` (alongside the ones T-002 and T-003 had each added,
one per function). No occurrence is by itself a P3 violation, but the
third crossed the "3+ instances require extraction" threshold from
`principles.md` P3 — and Review flagged it as a Blocker per the
review-checklist severity mapping. The Build Task Builder for T-005 had
`principles.md` in its `Reads first` set but did not run a scan across
the file before appending. Curating P3 enforcement into a structural
review by Build (or a deterministic pre-flight scan inside
`methods/task.md`) would catch this class of multi-task-cumulative
duplication before it reaches Review.

## 2026-05-18 — baseline-1779088275-1 — Review: deferred-concern comments are a design-conformance trap

`src/client/main.ts:refresh()` carried a T-002-era comment marking the
list-fetch error path as "lands with the mutation tasks that need it".
T-005 (a mutation task) added the matching `showListNotice` /
`clearListNotice` helpers but wired them only to the delete-error path,
leaving the list-fetch path still console-only. `design.md`
`## State and error handling > List` explicitly required the notice on
fetch failure — the deferred-concern comment was the only reminder, and
the Build Task Builder didn't sweep for it. Either drop the "deferred"
pattern entirely (resolve at the first task that touches the seam) or
treat `// T-NNN …` comments as a structured TODO surface that Build's
pre-flight scans against `board.md` to ensure they're cleared by the
time the referenced task is Done.

## 2026-05-18 — baseline-1779088275-1 — Review: speculative `eslint-disable-next-line` markers without a linter

Four `// eslint-disable-next-line no-console` markers in
`src/server/index.ts` and `src/client/main.ts` reference an ESLint
config that this project does not have (`spec.md`'s minimum-surface
constraint forbids installing one). The agent reached for a familiar
big-codebase idiom inside an explicitly small-surface project — a P5
"speculative scaffolding" smell. Worth a curated reminder that disable
directives belong only where the corresponding linter actually runs.
