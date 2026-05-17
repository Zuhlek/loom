---
project: baseline-1778963742-1
phase: plan
created: 2026-05-16
---

# Plan — Bookmarks (local-only)

Work graph for the four-feature local Bookmarks app described in `spec.md` and
shaped by `design.md`. Every active user story (US-001..US-004) is covered by
at least one task. All tasks are `AFK` — Build executes the entire pipeline
non-interactively.

## Strategy

Slices are vertical around observable behaviour:

- **T-001** is a single-layer bootstrap (tooling) — strictly necessary because
  every downstream task depends on `npm install`, the TypeScript compiler, the
  Vitest runner, and the `esbuild` driver being wired into `package.json`.
  Justification for a single-layer task: without this scaffold no behaviour
  task can compile, run, or assert. It is unblocking infrastructure, not
  architecture polish — kept deliberately minimal (`package.json`, `tsconfig`s,
  `vitest.config.ts`, `.gitignore`, npm scripts).
- **T-002** delivers persistence and the URL-normalisation/duplicate-guard
  contract (ADR-003, ADR-009) at the repository layer with unit tests against
  an in-memory SQLite. Covers the storage half of US-001, US-002, US-004.
- **T-003** delivers the HTTP API surface (POST/GET/DELETE) with supertest
  integration tests through `createApp(:memory:)` (ADR-007), exercising all
  contracted status codes incl. 409 duplicate and 404 delete-of-missing.
- **T-004** delivers the single-page client bundle (HTML/CSS/main.ts) including
  list render, save form with inline error, delete handler, and open-in-new-tab
  links with `rel="noopener noreferrer"` (ADR-008, US-003 security envelope).
- **T-005** wires the boot entrypoint, serves the bundle from the same origin,
  and adds an end-to-end smoke test that spins the real app on an ephemeral
  port and exercises POST → GET → DELETE.

## Coverage matrix

| Story  | Covered by                  |
| ------ | --------------------------- |
| US-001 | T-002, T-003, T-004, T-005  |
| US-002 | T-002, T-003, T-004, T-005  |
| US-003 | T-004, T-005                |
| US-004 | T-002, T-003, T-004, T-005  |

## DAG (blocked-by)

```
T-001  (root — tooling)
  ├── T-002  (db + repo)
  │     └── T-003  (http api)
  │           └── T-005  (entrypoint + e2e smoke)
  └── T-004  (client bundle)
        └── T-005
```

No cycles. All `blocked-by` references resolve to a declared task.

## Verification environment

`node-test` — Vitest 1.x on Node 20+, invoked via `npm test` from `./app/`.
The harness will run `npm install && npm test` against the workspace.

- Unit + integration tests use Vitest with `supertest` driving
  `createApp(new Database(':memory:'))` per ADR-007. No real port is bound for
  these tests.
- The E2E smoke test in T-005 binds an ephemeral port (`app.listen(0)`),
  performs HTTP round-trips via `node:http`, and closes the server cleanly so
  the suite remains hermetic.

## Out-of-band invariants

- **Workspace isolation.** Every file created by every task lives under
  `.loom/baseline-1778963742-1/app/`. Build MUST NOT write outside that
  directory.
- **Stack pinning.** Tasks may not substitute deps; the locked set is express,
  better-sqlite3, esbuild + vitest, supertest, typescript, tsx, @types/*.
- **Mutation testing.** Not in scope (see `tests.md`).
