---
project: baseline-1779111523-1
phase: plan
created: 2026-05-18
---

# Plan — baseline-1779111523-1

Executable work graph for the local-only Bookmarks app. Slices the
five user stories from `spec.md` (US-001..US-005) into five vertical
tasks (T-001..T-005), each delivering observable behaviour end-to-end
through the layers defined in `design.md` (HTTP route → repository →
SQLite, plus client bundle when user-visible).

All work lands inside `.loom/baseline-1779111523-1/app/` per the
workspace-isolation harness directive. `npm start` and `npm test` MUST
be runnable from that directory.

## Slicing rationale

The story graph admits a natural spine: list-the-empty-collection
(US-002, plus US-005's "DB file on disk" guarantee) is the smallest
slice that forces the full stack to exist (server, DB bootstrap,
repository, static handler, client bundle, render loop). Every other
story extends one verb (POST / DELETE) or one DOM behaviour (open
target=_blank) on top of that spine. We therefore make T-001 the
spine and fan T-002..T-004 off it. T-005 is the cross-cutting restart
test that proves the persistence guarantee end-to-end; it depends on
the four feature slices being in place so the assertion has data to
survive.

| Task | Slice | Stories |
| --- | --- | --- |
| T-001 | Workspace + spine: list endpoint, empty state, DB file bootstrap | US-002, US-005 |
| T-002 | Save: POST route, validation, duplicate handling, save form | US-001 |
| T-003 | Open in new tab: anchor rendering with `target="_blank"` and `rel` hardening | US-003 |
| T-004 | Delete: DELETE route, per-row delete button, re-fetch after mutation | US-004 |
| T-005 | Restart persistence end-to-end gate | US-005 |

US-005 is satisfied jointly: T-001 introduces the on-disk SQLite file
(the structural condition for AC2), and T-005 is the explicit acceptance
gate that demonstrates restart survival end-to-end (AC1). Both tasks
list US-005 in `satisfies-stories` per the agent's coverage rule
(every active story covered by at least one task; multiple tasks may
contribute).

## DAG

```
T-001 (spine: bootstrap + list + empty state)
  ├── T-002 (save)
  │     └── T-003 (open in new tab — depends on render path from save)
  │     └── T-004 (delete — depends on rows existing to delete)
  │           └── T-005 (restart persistence — exercises save+restart+list+delete)
```

No cycles. Every `blocked-by` resolves to an existing task.

## Coverage check

| Story | Covered by |
| --- | --- |
| US-001 | T-002 |
| US-002 | T-001 |
| US-003 | T-003 |
| US-004 | T-004 |
| US-005 | T-001 (structural), T-005 (acceptance gate) |

Every active story from `spec.md ## User stories` is satisfied by at
least one task. No orphan tasks (every task lists at least one story).

## Verification environment

`node-test` — Vitest test suite runnable via `npm test` from
`.loom/baseline-1779111523-1/app/`. The Vitest runner builds the
Express app in-process via `createApp(repo)` (see
`design.md § TypeScript signatures`) and exercises the JSON API with
`supertest` or Node's built-in `fetch` against `app.listen(0)`. Each
test file uses a temp SQLite path via `BOOKMARKS_DB_PATH`
(`ADR-009`). No browser harness is required: the client bundle is
covered indirectly by HTTP-layer behaviour tests; pure DOM rendering
is covered by import-level unit tests of `src/client/main.ts`'s
escape and render helpers, since vanilla TS with no framework keeps
the renderable surface a pure-function shell.

Build MUST be able to:
- run `npm ci` (or equivalent install) inside `app/`.
- run `npm test` inside `app/` to a clean exit code.
- run `npm start` and confirm a `GET /` returns the static HTML, then
  shut it down (used by the smoke check, not the unit suite).

If the runtime cannot execute `npm` from a writable workspace under
`.loom/baseline-1779111523-1/app/`, Build's pre-flight returns
`status: blocked` with the missing capability surfaced; no silent
substitution.

## Layer concerns

The design exposes seven internal layers (server entry, HTTP routes,
repository, DB bootstrap, validation, client bundle, static assets).
Each task touches at least two layers — see per-task
`touches-layers` — except T-005 which is a cross-cutting acceptance
gate that touches `tests` only; T-005's single-layer justification is
that it is an end-to-end persistence assertion implemented as a Vitest
spec exercising the existing repository through a process-recreate
loop, not new product code.

## Mutation testing

`tests.md` declares `**Mutation Testing:** no`. The app handles no
money, no irreversible operations, no security boundaries (single
user, localhost, no auth). The UNIQUE-URL invariant (the strongest
load-bearing rule) is enforced in SQL and asserted by direct duplicate
tests in T-002. Mutation cost is not justified at this scope.

## Open ambiguity

None. The three Design-level UX defaults (URL validation strictness,
delete confirmation, duplicate error wording) are settled in
`design.md` ADR-006 / ADR-007 / `§ Open ambiguity` and inherited
verbatim here.

## Build phase entry conditions

- `npm` available, Node 20+ runtime, writable
  `.loom/baseline-1779111523-1/app/` directory.
- T-001 must be the first task picked: it scaffolds the workspace
  every subsequent task assumes.
