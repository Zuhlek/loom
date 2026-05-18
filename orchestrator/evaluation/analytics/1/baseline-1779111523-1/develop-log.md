---
project: baseline-1779111523-1
phase: build
created: 2026-05-18
---

# Develop log — baseline-1779111523-1

Build-phase observations, dual-written with `orchestrator/log/build.md`.

## T-001 — Bootstrap

- Workspace under `.loom/baseline-1779111523-1/app/`. Verified `node -v`
  (v25.x) and `npm -v` (11.x) before scaffolding; `npm install` added
  194 packages cleanly.
- Decision shape inherited from `design.md`:
  - Repository module is the only `better-sqlite3` importer.
  - `BOOKMARKS_DB_PATH` env var (ADR-009) wired through `openDatabase`
    so every test file uses a temp SQLite path. Default resolves to
    `${cwd}/data/bookmarks.sqlite`.
  - `createApp(repo)` returns a real Express handle that supertest can
    drive without `listen(0)`.
- Stubbed `create()` and `delete()` to throw `not yet implemented` per
  the task spec; wired in T-002 / T-004.

## T-002 — Save (POST)

- `normaliseInput` trims, then runs `new URL(url)` for validation
  (ADR-006). No scheme allow-list.
- Repository attempts INSERT and catches `SQLITE_CONSTRAINT_UNIQUE`
  (ADR-003); also fall-back regex on `UNIQUE` substring for older
  bindings. Returns the freshly-read row via `getByIdStmt` to inherit
  the SQL default for `created_at`.
- Routes map `ValidationError` → 400 (preserving `.field`),
  `DuplicateUrlError` → 409 with the canonical "Already bookmarked."
  message and `field: 'url'`.

## T-003 — Open in new tab

- Two anchors per row (title + URL) with `target="_blank"` and
  `rel="noopener noreferrer"` per the security note in T-003. Both
  the `href` attribute and the visible text pass through `escapeHtml`.
- The delete button later (T-004) is rendered as a sibling outside
  both anchors so click delegation never races with anchor activation.

## T-004 — Delete

- `repo.delete(id)` returns `info.changes > 0`.
- DELETE route guards on non-integer ids with a 400; 404 when the
  repo reports no row removed; 204 on success.
- Client: `resolveDeleteTarget` walks `parentElement` from the click
  target to find `data-action="delete"`. This survives a click on
  any descendant inside the button (e.g. an icon span).
- `happy-dom` added as a devDep to provide a `document` for the
  delegation test. Recorded as the only out-of-scope edit.

## T-005 — Restart persistence gate

- Stage 1 / stage 2 use the SAME `BOOKMARKS_DB_PATH`. Between stages
  we explicitly `.close()` the SQLite handle to release file locks,
  then `openDatabase(samePath)` again. This is the cheapest faithful
  emulation of `npm start` → SIGTERM → `npm start`.
- Negative control uses a fresh path and asserts the list is empty —
  confirms the persistence claim hinges on the file, not on shared
  process state.

## Smoke

- `npm start` bound on PORT=3737 with a temp DB path; `curl /` and
  `curl /api/bookmarks` both succeeded; `SIGTERM` returned the
  process cleanly.

## Notes for future phases

- The synchronous `better-sqlite3` API + `tsx` runner means there's no
  compile step at boot beyond the esbuild client bundle (~5kb output).
- DB writes share a single connection per process; if/when the scope
  grows beyond a single-user laptop, the repository module is the
  one place to introduce pooling.

## 2026-05-18 - baseline-1779111523-1 - review pass, no blockers, three notes

Review walked intent / design / plan / evidence / principles P1-P7
against the diff under `app/`. All five stories satisfied by passing
Vitest specs (40/40), all five tasks Done, smoke gate PASS. No
blockers, no major findings.

Three notes for the curation backlog:

- DELETE route emits a `400 invalid_input` for non-integer `:id`
  that `design.md § Interfaces` does not enumerate. Behaviour is
  defensive and correct; doc lag, not a code defect. Worth nudging
  Plan/Design templates to encourage Interfaces tables that list
  parse-guard error codes alongside the documented success/failure
  pair.
- `renderListHtml` is consumed only by tests; the runtime `render()`
  path duplicates its row composition inline (the empty-state branch
  differs). P5 boundary case: technically has a consumer, but not
  the runtime one. A one-line delegation would unify both. Worth
  encoding as a "no test-only renderer" check in `task.md`'s review
  prompts.
- `happy-dom` devDep was added during T-004 to drive a DOM delegation
  test and recorded as an `out-of-scope-edits` line. Disclosure was
  correct, but the original plan should have flagged that DOM-test
  packages would be needed. A small Plan-phase improvement: when a
  task touches `client-bundle` and adds DOM-shaped tests, surface
  the test-runtime dep up front in `files-likely-touched` rather
  than discovering it mid-Build.

Dual-write: project-local entry above, global shard entry appended
to `orchestrator/log/audit.md` with the matching `## 2026-05-18 -
baseline-1779111523-1 - <topic>` heading.

