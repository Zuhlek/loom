---
project: baseline-1779428627-1
phase: plan
created: 2026-05-22
---

# Plan — baseline-1779428627-1

Executable work graph for the local-only Bookmarks app. The graph slices
the four user stories (`US-001`..`US-004`) into nine vertical tasks
(`T-001`..`T-009`). Every task is `AFK`; there is no human-in-the-loop
work. Coverage is asserted per-task via `satisfies-stories` frontmatter
and aggregated in `task.md`.

## Approach

- **Vertical slicing.** Each task delivers a thin, observable behaviour
  rather than a horizontal layer. T-002 owns the SQLite layer for list /
  create / delete because the repository contract is one unit of
  concern; T-004 wires the HTTP routes that use it; T-006 / T-007 / T-008
  deliver the user-facing slices that exercise those routes through the
  DOM.
- **Single-layer tasks are justified explicitly.** T-001 (scaffolding),
  T-002 (data), T-003 (validation/errors), and T-005 (static HTML/CSS)
  each touch one layer. They exist as single-layer tasks because the
  contracts they own (build config, repository interface, error taxonomy,
  DOM hook ids) are consumed by multiple downstream behaviour tasks; not
  factoring them creates duplicated work and contract drift across the
  story-shaped tasks.
- **Server-first ordering.** The repository contract (T-002) and HTTP
  routes (T-004) land before the client slices that depend on them, so
  the client slices can be built against a real running endpoint surface.
- **Workspace isolation.** Every task's `files-likely-touched` is rooted
  at `.loom/baseline-1779428627-1/app/`. No task writes outside that
  directory.

## Story-to-task coverage map

| Story | Tasks |
| --- | --- |
| `US-001` Save a Bookmark | T-002, T-003, T-004, T-007 |
| `US-002` View All Saved Bookmarks | T-002, T-004, T-005, T-006 |
| `US-003` Open a Bookmark in a New Tab | T-005, T-006 |
| `US-004` Delete a Bookmark | T-002, T-003, T-004, T-008 |

Every active `US-NNN` story in `spec.md` is satisfied by at least one
task. T-001 (scaffold) and T-009 (entry + build wiring) are envelope
tasks — they satisfy structural acceptance from `## Constraints` (npm
start boots :3000, same-origin, npm test runs Vitest) which every story
depends on transitively. They carry an explicit `satisfies-stories` list
mirroring that dependence.

## DAG

```
T-001 (scaffold)
  ├── T-002 (repository + schema)
  │     ├── T-003 (validation + errors)
  │     │     └── T-004 (HTTP routes)
  │     │           ├── T-007 (client create form)
  │     │           ├── T-008 (client delete)
  │     │           └── T-009 (server entry + build)
  │     └── T-004
  ├── T-005 (HTML shell + CSS)
  │     └── T-006 (client api + render)
  │           ├── T-007
  │           └── T-008
  └── T-005
```

No cycles. Every `blocked-by` edge resolves to an existing task.

## Verification environment

`node-test`

Build runs `cd .loom/baseline-1779428627-1/app && npm install && npm test`.
Vitest is the authoritative harness for every acceptance gate declared in
`tests.md`:

- Server route specs use the Express app factory + an in-memory SQLite
  (`new Database(':memory:')`) and assert response status, body shape, and
  persisted state directly against the injected repository.
- Client unit specs cover pure functions (`render.ts`, `validation.ts`,
  `api.ts`) under jsdom (Vitest's default DOM environment).
- A smoke spec exercises `npm start` indirectly by booting `createApp` on
  an ephemeral port and asserting `/api/bookmarks` round-trips through
  `fetch`.

There is no headless-browser harness; the end-to-end browser walkthrough
declared as the spec's out-of-band success criterion is a human gate
performed after Build returns, not a Build-phase verification. Build's
pre-flight only needs Node + npm.

## Notes for Build

- `T-001` is the only task that creates `app/` from scratch; every later
  task assumes the directory and tooling exist. If a Build agent picks a
  later task while T-001 is incomplete, it must surface the violation
  rather than re-create `app/` ad hoc.
- The DOM hook ids in `design.md` (`#bookmark-form`, `#bookmark-list`,
  `#empty-state`, etc.) are the contract between T-005 and T-006/T-007/
  T-008. Renames need to land in all four tasks atomically.
- `BookmarkRepository` (shape in `design.md` § Interfaces) is the
  contract between T-002 and T-004; tests in T-004 should not import
  from `db.ts` directly.
