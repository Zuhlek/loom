---
project: baseline-1778968525-1
phase: plan
created: 2026-05-17
---

# Plan — baseline-1778968525-1

## Verification environment

`node-test` — Vitest is pinned by the seed. All task verification runs `npm test`
from `app/` (Vitest suite) plus, where applicable, a `tsc --noEmit` type check.
A subset of tasks add a smoke check via `npm start` followed by an HTTP probe of
`http://localhost:3000`, but the authoritative pass/fail signal is the Vitest
suite.

## Slice strategy

Vertical slices around observable behaviour:

1. **T-001** lays the workspace skeleton (package.json, tsconfig, build.mjs,
   directory tree, .gitignore). No user-visible behaviour yet, but unblocks
   every subsequent task.
2. **T-002** wires the SQLite bootstrap + schema (UNIQUE constraint, index).
   Unblocks every repository and route task.
3. **T-003** ships the repository layer (`listBookmarks`, `createBookmark`,
   `deleteBookmark`) with its Vitest spec — this is the data-layer slice that
   delivers the storage portion of US-001 / US-002 / US-004.
4. **T-004** ships the validation module + spec.
5. **T-005** assembles the Express app factory, `errors.ts`, and the global
   error-handling middleware that maps `ValidationError` /
   `DuplicateUrlError` / `NotFoundError` to the `{ error: { code, message } }`
   contract (ADR-008).
6. **T-006** delivers the three HTTP routes (GET, POST, DELETE) plus their
   `supertest` specs — this is the network-edge slice for US-001, US-002,
   US-004.
7. **T-007** wires the server bootstrap (`index.ts`) — opens the DB, builds
   the app, binds to `127.0.0.1:3000`, serves `public/` same-origin.
8. **T-008** ships the static UI shell (`index.html`, `styles.css`) — form +
   list region + empty-state copy. Delivers the structural slice of US-002.
9. **T-009** ships the web bundle source (`api.ts`, `dom.ts`, `types.ts`,
   `main.ts`) — load+render newest-first, prepend on save, open-in-new-tab
   markup with `rel="noopener noreferrer"`, delete with inline error,
   inline form errors keyed off `error.code`. Closes US-001, US-002, US-003,
   US-004 at the UI level.
10. **T-010** wires the esbuild pipeline (`build.mjs`) and the `npm start` /
    `npm test` / `npm run build` scripts; adds a smoke spec that boots
    `buildApp` against an in-memory DB and asserts the static asset is
    served same-origin.

## Coverage matrix

| Story  | Tasks delivering acceptance criteria        |
| ------ | -------------------------------------------- |
| US-001 | T-003, T-004, T-005, T-006, T-009           |
| US-002 | T-003, T-006, T-008, T-009                   |
| US-003 | T-008, T-009                                 |
| US-004 | T-003, T-005, T-006, T-009                   |

Every active story is covered by at least one task. Every `blocked-by`
reference resolves to an earlier task. No cycles.

## Risk / non-coverage notes

- `tsc --noEmit` is not pinned by the seed; we run it as a soft type-check
  gate inside task verification but a Vitest pass is authoritative.
- ADR-007 leaves the server execution choice flexible (`tsx` vs. compiled).
  T-010 picks `tsx` and records the deviation as inert if Build prefers an
  alternative.
- The SQLite file location is also flagged in design as flexible
  (`app/data/bookmarks.sqlite` vs. `app/bookmarks.sqlite`). T-002 pins the
  former; either satisfies the constraint.

## Open ambiguity

- None. Spec and design fully constrain the deliverable. The two flexibility
  notes above are design-level, not plan-level — both options satisfy every
  acceptance criterion.
