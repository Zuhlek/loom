---
project: baseline-1779002783-2
phase: plan
created: 2026-05-17T08:35:00Z
---

# Plan — baseline-1779002783-2

Work graph for the local-only Bookmarks web app. Converts the five
accepted user stories (US-001..US-005), the Q01..Q05 resolutions, and
the 10 ADRs in `design.md` into an executable task list. Build picks
ready tasks from `board.md`; verifies via the harness declared below.

## Verification environment

`node-test` — Vitest test suite, executed by `npm test` from
`.loom/baseline-1779002783-2/app/`. The HTTP layer is exercised via
`supertest` against the Express app constructed with an in-memory
SQLite database (`:memory:`). The repository and validation layers are
exercised by direct Vitest unit tests. Build's pre-flight should
confirm that Node ≥ 20 is on PATH, that the workspace's `package.json`
declares `vitest` and `supertest` as devDependencies, and that
`npm test` runs Vitest from `./app/`.

A single optional smoke gate (`scripts/smoke.mjs`, invoked by `npm run
smoke`) boots the server against an on-disk `:memory:`-equivalent file
in a temp dir, hits `/api/bookmarks` over HTTP, and verifies the JSON
shape. This still runs under `node-test`-class tooling (no browser).

No `manual-browser-desktop` gate is required. The browser-side
behaviours (open in new tab, inline error rendering, empty-state copy)
are asserted by DOM-level unit tests against the client `render`
module using `happy-dom` (Vitest's default DOM environment).

## Strategy

- **Workspace.** All deliverables live under
  `.loom/baseline-1779002783-2/app/`. `package.json`, `tsconfig.json`,
  `src/`, `public/`, `tests/`, `scripts/`, and `node_modules/` are all
  inside that directory. `npm start` and `npm test` are run from there.
- **Slicing.** Tasks are vertical slices around observable behaviour
  where possible (list, create, delete, persist). Two tasks
  (scaffolding, client bootstrap) are intentionally single-layer because
  they establish the substrate every later slice depends on; the
  justification is recorded in each task file under `Single-layer
  justification`.
- **Dependency shape.** T-001 (scaffolding) blocks everything. T-002
  (storage + migration) blocks every server slice. The three server
  slices (list, create, delete) are parallelisable once T-002 is Done.
  The client tasks depend on at least one server slice landing so they
  can integrate against a live route surface during development.
- **Verification.** Every server slice carries Vitest unit + supertest
  integration tests. Every client task carries DOM-level unit tests
  against `render` and `api` modules using `happy-dom`. Story coverage
  is asserted via the `satisfies-stories` frontmatter; the matrix below
  shows the mapping.

## Coverage matrix (story → tasks)

| Story | Title | Covering tasks |
| --- | --- | --- |
| US-001 | Save a URL with a title | T-004, T-007 |
| US-002 | View all bookmarks newest-first | T-003, T-006, T-008 |
| US-003 | Open a saved bookmark in a new tab | T-008 |
| US-004 | Delete a bookmark | T-005, T-009 |
| US-005 | Bookmarks persist across server restarts | T-002, T-010 |

Every US-001..US-005 row has at least one covering task. T-001
(scaffolding) and T-010 (smoke) carry no `satisfies-stories` entry of
their own beyond the persistence one; they exist to make the rest
runnable and to validate the integration surface end-to-end.

Note on T-001: scaffolding is the structural prerequisite for every
story but does not by itself deliver any acceptance criterion's
observable behaviour. To satisfy the "every task carries at least one
`satisfies-stories` entry" rule, T-001 is tagged with US-005 because
its `npm start` and SQLite-file-path wiring are the minimum conditions
under which a restart can preserve state at all.

## Open ambiguity

None. All planning decisions resolved structurally from `spec.md` +
`decisions.md` + `design.md`.

## History

| timestamp | event |
| --- | --- |
| 2026-05-17T08:35:00Z | initial plan written; 10 tasks, all AFK |
