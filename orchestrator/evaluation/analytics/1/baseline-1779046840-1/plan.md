---
project: baseline-1779046840-1
phase: plan
created: 2026-05-17T21:50:00Z
---

# Plan — baseline-1779046840-1

Executable work graph for the local-only Bookmarks app. User stories
US-001…US-004 are defined in `spec.md`; the technical structure is in
`design.md`. This plan slices that structure into vertically observable
tasks the Build coordinator can pick from `board.md`.

## Verification environment

`node-test`

The acceptance gates declared in `tests.md` execute via Vitest 2.x
(plus `supertest` for HTTP-level checks) inside `./app/`. Build runs
`cd .loom/baseline-1779046840-1/app/ && npm install && npm test`
autonomously; no browser harness, no human-in-the-loop verification.
A final smoke gate also runs `npm run build` to confirm the bundle
compiles and that `npm start` can locate `dist/server/index.js`.

## Slicing strategy

Each task delivers a thin, observable slice of one or more user-stories'
acceptance criteria. Server-side and client-side concerns are split
where the seam is natural — the API for a feature is testable in
isolation via supertest, and the client behaviour is testable via
Vitest against jsdom-style DOM helpers. The split avoids a single
"build the server" or "build the client" megatask while keeping every
slice behaviour-shaped.

Foundation tasks (scaffold, db, app factory, static + shell, client
api+dom) are not behaviour slices on their own; their justification
for being single-layer is recorded inside each task file. They unblock
multiple behaviour slices and would otherwise be duplicated.

## Story → task coverage

| Story | Tasks |
| --- | --- |
| US-001 (save) | T-004 (server), T-009 (client) |
| US-002 (list newest-first) | T-003 (server), T-008 (client) |
| US-003 (open in new tab) | T-010 (client) |
| US-004 (delete) | T-005 (server), T-011 (client) |

Every active `US-NNN` story is covered by at least one task; coverage
is asserted by each task's `satisfies-stories` frontmatter.

## Dependency graph (summary)

```
T-001 (scaffold)
  ├── T-002 (db)
  │     └── T-003 (GET) ── T-004 (POST) ── T-005 (DELETE)
  ├── T-006 (static + shell) ── T-007 (client api+dom)
  │                                 ├── T-008 (list render)  [needs T-003]
  │                                 ├── T-009 (save form)    [needs T-004, T-008]
  │                                 ├── T-010 (open in tab)  [needs T-008]
  │                                 └── T-011 (delete row)   [needs T-005, T-008]
  └── T-012 (smoke gate)            [needs every task above]
```

The graph is acyclic. Every `blocked-by` resolves to a task that
exists. Foundation tasks T-001, T-002, T-006, T-007 are explicitly
single-layer; their justification is in the task files.

## Task type summary

- AFK: 12
- HITL: 0

Every task is `AFK`. There is no manual gate; the spec, design, and
constraint set are fully resolved and no decision in this phase
requires user input.

## Open ambiguity

None. The Spec and Design phases resolved every structural choice; the
plan only refines them into a dispatch order.
