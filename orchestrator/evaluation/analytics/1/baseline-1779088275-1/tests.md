---
project: baseline-1779088275-1
phase: plan
created: 2026-05-18
---

**Mutation Testing:** no

# Tests — baseline-1779088275-1

Phase-wide verification strategy. Per-task test sketches live in each `tasks/T-*.md`; this file declares the gate shape, the harness, and the smoke / mutation policy.

## Why no mutation testing

The deliverable is a single-user, local-only Bookmarks app with no security boundary, no money handling, no irreversible operation beyond `DELETE` of a row the user themselves just clicked. Mutation testing is reserved for logic whose bug-impact justifies the cost; nothing here qualifies. The acceptance gates below give end-to-end coverage of every story without it.

## Harness

`node-test` — declared in `plan.md` `## Verification environment`. Concretely:

- `tsc --noEmit` runs first under `npm test` and fails the suite on any type error.
- `vitest run` (Vitest's default environment is Node; the frontend-render specs opt into `happy-dom` per-file via `// @vitest-environment happy-dom`).
- HTTP-boundary tests construct the Express app in-process and probe it with `supertest`. No port is bound during tests.
- Repo tests construct `new Database(':memory:')` via the `db.ts` factory. The on-disk SQLite file (`./data/bookmarks.db`) is never touched by tests.
- `Date.now()` is stubbed via `vi.useFakeTimers()` in tests that assert on `created_at` ordering.

## Acceptance gates by story

Each gate is one or more behavior-level test cases; the EARS clauses in `spec.md` are the source of truth for the assertions.

### US-001 (save) — covered by T-003

- Submitting a non-empty title + `http://example.com/` URL persists a row and returns the persisted row from a subsequent `GET /api/bookmarks` without a page reload (driven by the in-process supertest probe + a happy-dom render assertion).
- Submitting an empty / whitespace-only title returns 400 `INVALID_TITLE` with `field: "title"`; no row is persisted.
- Submitting an invalid URL (`not-a-url`, `ftp://example.com`, `javascript:alert(1)`) returns 400 `INVALID_URL` with `field: "url"`; no row is persisted.
- Submitting a URL that already exists returns 409 `DUPLICATE_URL` with `field: "url"`; the original row is untouched.
- The add-form clears its inline error on the next input event for the field that errored (happy-dom render spec).

### US-002 (list) — covered by T-002

- `GET /api/bookmarks` returns `{ bookmarks: [] }` against an empty database.
- After two inserts at distinct `created_at` values, `GET /api/bookmarks` returns the newer row first.
- After two inserts at the same `created_at` (clock stubbed), the higher `id` appears first (tiebreak).
- The empty-state DOM is rendered when `bookmarks` is `[]`; the list DOM replaces it when `bookmarks` is non-empty.
- Each rendered list item exposes both the title text and the URL (visible or accessible).

### US-003 (open in new tab) — covered by T-004

- Each rendered list item's title is an `<a>` element whose `href` equals the bookmark's URL.
- Each anchor carries `target="_blank"` and `rel="noopener noreferrer"` (the latter is the platform contract for "do not let the new tab navigate the originator").
- Activating the anchor (`click`) does not call any internal handler that would navigate the originating window — the spec is asserted by inspecting the anchor's attributes, not by simulating a real browser navigation (jsdom cannot open a tab).

### US-004 (delete) — covered by T-005

- `DELETE /api/bookmarks/:id` for a row that exists returns 204 and removes the row from `GET /api/bookmarks`.
- `DELETE /api/bookmarks/:id` for a row that does not exist returns 204 (idempotent no-op).
- `DELETE /api/bookmarks/:id` for a non-integer / negative / missing id returns 400 `INVALID_ID`.
- After a successful delete, the frontend refetches `GET /api/bookmarks` and the deleted row is no longer rendered.
- The per-row delete control is disabled during its own `deleting` state.

## Smoke gates (phase-wide)

These are independent of any single story and run for every Build attempt:

- `npm install` resolves without error from `./app/`.
- `tsc --noEmit` reports zero errors.
- `vitest run` exits zero.
- `npm start` (in a child process, with a smoke timeout) boots, serves `GET /` with a 200 HTML response containing the `#bookmarks` mount node, then shuts down cleanly. (Implemented as one Vitest spec that spawns the server child process and probes `localhost:3000`; gated behind a `SMOKE=1` env var so the unit suite stays in-process.)

The smoke spec is the canonical proof of the `npm start` run contract (`spec.md` `## Constraints`).

## Test layout

```
app/tests/
  unit/
    validation.test.ts        ; pure parseTitle / parseUrl
    repo.test.ts              ; insert / listAll / deleteById against :memory:
    render.test.ts            ; happy-dom; renderList, renderEmptyState, showFormError
  http/
    bookmarks.test.ts         ; supertest probes against the in-process Express app
  client/
    api.test.ts               ; fetch mocked; ApiError mapping
  smoke/
    run.test.ts               ; spawns `npm start`; guarded by SMOKE=1
```

## What is intentionally not tested

- Real browser navigation when the user clicks a bookmark anchor (US-003 AC-1, AC-2). Asserted by attribute inspection; a real "open in new tab" requires a real browser and is outside the `node-test` harness.
- Production-mode SQLite durability across an OS-level crash. The spec demands "survive a server restart" — covered by the repo+http test that round-trips data through a fresh `db.ts` open against a temp file path, not by a kill-9 simulation.
- CSS rendering. `@media (prefers-color-scheme: dark)` is asserted as a literal CSS rule presence in `public/style.css` if at all; visual regression is out of scope.

## Open ambiguity

None.
