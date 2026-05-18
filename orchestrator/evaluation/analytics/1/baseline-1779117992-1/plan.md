---
project: baseline-1779117992-1
created: 2026-05-18
phase: plan
---

# Plan — Bookmarks

Work graph for the local-only Bookmarks app specified in `spec.md` and
structured in `design.md`. Slicing is vertical around observable behaviour
from `US-001..US-004`, with three thin foundation tasks that exist solely
to make the first behavioural slice runnable. Each behaviour-slice ships
end-to-end (server route + client wiring + tests).

## Verification environment

`node-test`

Build executes the acceptance gates declared in `tests.md` using Vitest
inside `./app/`. The web slice uses Vitest's `jsdom` environment for the
`renderList` / form-submit smoke test, so no real browser is required and
no separate harness is involved. `npm test` from `.loom/baseline-1779117992-1/app/`
is the single command Build runs.

## Slicing strategy

- **US-001 (save):** delivered by T-002 (repo `createBookmark` + UNIQUE
  index) and T-004 (POST route + client form submit + inline errors).
  The vertical slice lands in T-004; T-002 is the persistence half it
  consumes.
- **US-002 (list):** delivered by T-002 (`listBookmarks` query +
  newest-first ORDER BY) and T-005 (GET route + client `renderList`,
  including the empty-state path). The vertical slice lands in T-005.
- **US-003 (open):** delivered by T-005's render (which is what produces
  the row anchor) and T-006 (the `target="_blank" rel="noopener
  noreferrer"` open affordance + the "list preserved in original tab"
  assertion).
- **US-004 (delete):** delivered by T-002 (`deleteBookmark` +
  `NotFoundError`) and T-007 (DELETE route + client delete handler +
  404 → refetch reconciliation).

T-001 (scaffold) and T-003 (server shell + static serving) are
foundation enablers — they touch no story criteria directly but are
prerequisites for the behavioural slices to run.

## Layer coverage

The deliverable's concern boundaries are: `scaffold` (package / tsconfig /
esbuild), `db` (`db.ts`, schema, pragmas), `repo` (SQL only),
`route` (HTTP shape), `app` (Express wiring, static, error envelope),
`web-html` (static shell + CSS), `web-ts` (client logic + DOM), `tests`
(Vitest at repo / api / web layers).

Most behavioural tasks span `route` + `web-ts` + `tests` so a slice ships
end-to-end. Single-layer tasks are justified inline.

## Risk and HITL posture

All tasks are `AFK`. The build is fully automatable: TypeScript, Vitest,
better-sqlite3, esbuild — every gate runs headlessly. There is no design
review, no credential, no manual browser walk. The Spec/Design phases
already captured every branching decision (Q01..Q05 in `decisions.md`,
ADR-001..ADR-007 in `design.md`), so Plan introduces no new ambiguity
requiring a human.

## Graph validation

- Every story `US-001..US-004` is covered by at least one task's
  `satisfies-stories` (see `task.md` mapping).
- Every `blocked-by` reference resolves to an existing `T-NNN`.
- The DAG is acyclic: T-001 → T-002, T-003 → T-004, T-005, T-006, T-007;
  T-002 → T-004, T-005, T-007; T-005 → T-006 (open affordance lives on
  rendered rows).

## Open ambiguity

None. The verification environment is fully autonomous; the four
stories map cleanly to seven tasks; no Plan-critical question requires
a human answer.
