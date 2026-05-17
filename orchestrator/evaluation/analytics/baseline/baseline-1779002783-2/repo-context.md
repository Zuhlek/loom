# Repo Context — baseline-1779002783-2

## Seed-relevant slice

This fabric is a **greenfield Node/TypeScript subproject** isolated under
`.loom/baseline-1779002783-2/app/`. It does NOT extend or import from the
host loom orchestrator codebase.

Cross-reference: see `.loom/.cache/repo-digest.md` for the host-repo facts
(orchestrator layout, fabric isolation conventions, gitignore rules).

## Workspace isolation (harness directive)

The seed's `HARNESS-DIRECTIVE` block pins **all** deliverable files to
`./app/` relative to the seed location:

- Absolute path for this fabric: `/Volumes/My Shared Files/repo/loom/.loom/baseline-1779002783-2/app/`
- Files affected: `package.json`, `tsconfig.json`, source code, tests,
  build output, `node_modules`, the SQLite database file, anything
  `npm` writes.
- Commands: `npm start` and `npm test` must be runnable from `./app/`.
- This is an **invariant**, not a recommendation. Surface verbatim in
  `spec.md ## Constraints`.

## Stack (frozen by the seed — no substitutions)

The seed explicitly fixes the stack. Grilling MUST NOT re-open these:

- Language: TypeScript everywhere.
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, on-disk file next to the server.
- Frontend: plain HTML + CSS + vanilla TypeScript, bundled via `esbuild`
  to a single JS bundle. No React / Vue / framework.
- Tests: Vitest.
- Entry points: `npm start` boots `http://localhost:3000` and serves the
  UI from the same origin; `npm test` runs the Vitest suite.

## Integration points

None. Single-process, single-user, local-only. No auth, no deploy, no
external services, no telemetry.

## Files likely to be created under `./app/`

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild` config or
  build script.
- `src/server/` — Express app, route handlers, SQLite access layer.
- `src/client/` — vanilla TS for the bookmark UI.
- `public/` (or equivalent) — `index.html`, CSS, the esbuild output bundle.
- `tests/` — Vitest unit + integration tests.
- `bookmarks.sqlite` (or similar) — created at runtime by `better-sqlite3`.

## Open questions for grilling (from seed's own list)

The seed explicitly lists five undecided points to ask the user:

1. Tags / categories vs flat list → Q01
2. Duplicate URL handling on save → Q02
3. Search box present? → Q03
4. Edit-after-creation vs immutable → Q04
5. Sort order options → Q05

These map 1:1 to the canned `q_id`s in `.answers.yaml`.

## Out-of-repo facts grilling will need

None — the seed is self-contained. No external compliance, regulatory,
or team-process facts in play (single user, local-only).
