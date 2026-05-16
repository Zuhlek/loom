---
project: baseline-1778931123-1
phase: plan
created: 2026-05-16
---

# Plan — Bookmarks

Executable work graph for the local-only Bookmarks app described in `spec.md`
and structured in `design.md`. Tasks are sliced vertically around observable
behaviour from US-001..US-005. Every story is covered by at least one task.
Every task starts in `Backlog` (see `board.md`).

## Verification environment

```text
node-test
```

Build executes the acceptance gates by running:

- `npm test` from `.loom/baseline-1778931123-1/app/` — Vitest suite, including
  unit tests against the repo and integration tests against `buildApp(repo)`
  via `supertest`. This is the primary gate for US-001..US-004 acceptance
  criteria.
- `npm start` smoke check — Build invokes `npm start` (background) and a CLI
  probe (`curl` against `http://localhost:3000` and `/api/bookmarks`) to
  validate US-005 AC1 (boot + same-origin serving) and US-002 AC1/AC3
  (empty-state vs populated rendering) end-to-end. Probe gates also assert
  the SQLite file appears at `app/bookmarks.sqlite` and survives a restart.

Both gates run from the same `app/` directory using the locked stack
(`vitest`, `supertest`, `tsx`, `better-sqlite3`, `express`, `esbuild`).
No browser harness is required — link semantics (`target="_blank"`,
`rel="noopener"`) are verified by asserting on rendered HTML strings or
on the DOM produced by client unit tests in `jsdom`. No HITL gates.

## Work graph

The DAG below sequences tasks so that each task depends only on layers
already in place. Frontmatter `blocked-by` fields are authoritative; this
table is informational.

| Task | Title | Type | Layer | Blocked by | Stories |
| --- | --- | --- | --- | --- | --- |
| T-001 | Workspace scaffold + dependencies + scripts | AFK | build/tooling | — | US-005 |
| T-002 | SQLite schema, migration, and repo (list/getById/create/deleteById) | AFK | data | T-001 | US-001, US-002, US-004 |
| T-003 | Express API router + buildApp wiring + validation | AFK | http-api | T-002 | US-001, US-002, US-004 |
| T-004 | Server entrypoint, boot sequence, static handler | AFK | server-process | T-003 | US-002, US-005 |
| T-005 | Client shell (index.html + styles.css + esbuild build script) | AFK | client-build | T-001 | US-002, US-005 |
| T-006 | Client API module and list rendering with empty-state | AFK | client-app | T-004, T-005 | US-002, US-003 |
| T-007 | Save-bookmark form with inline validation + duplicate errors | AFK | client-app | T-006 | US-001 |
| T-008 | In-row two-step delete confirmation + post-delete refresh | AFK | client-app | T-006 | US-004 |
| T-009 | Persistence-across-restart smoke + npm start/test gate verification | AFK | integration | T-004, T-007, T-008 | US-005 |

### Story coverage matrix

| Story | Covered by |
| --- | --- |
| US-001 Save | T-002, T-003, T-007 |
| US-002 List | T-002, T-003, T-004, T-005, T-006 |
| US-003 Open | T-006 |
| US-004 Delete | T-002, T-003, T-008 |
| US-005 Boot/test | T-001, T-004, T-005, T-009 |

Every active story has at least one task. Every `blocked-by` resolves to a
task in this plan. The DAG is acyclic (linear-with-fan-out from T-001).

## Layer coverage

- **build/tooling** — T-001
- **data (SQLite + repo)** — T-002
- **http-api (Express router, validation, error mapping)** — T-003
- **server-process (boot, static handler, lifecycle)** — T-004
- **client-build (esbuild, static assets)** — T-005
- **client-app (vanilla TS UI: list, form, delete)** — T-006, T-007, T-008
- **integration (end-to-end boot + persistence)** — T-009

## Constraints carried forward

All tasks operate inside `.loom/baseline-1778931123-1/app/`. No file is
written outside this directory. The stack lock from `spec.md ## Constraints`
applies to every task — no framework substitutions, no extra runtime
dependencies beyond those listed in `design.md ## Integration points`.

## Open ambiguity

None. All Spec-phase questions resolved in `decisions.md` (Q01–Q05);
implementation tactics fixed in `design.md`.
