---
project: baseline-1779002783-1
phase: plan
created: 2026-05-17
---

# Plan — Bookmarks

## Overview

Build the local-only Bookmarks app as twelve thin, vertical slices under
`./app/`. Foundation first (workspace scaffold, then persistence and the
Express skeleton), then three API endpoints (list / create / delete),
then frontend bundling and the matching UI slices (list-with-empty-state +
open-in-new-tab, create form with inline errors, delete control), then
the `npm start` entrypoint that boots the file-backed DB on port 3000,
then a final smoke-and-isolation guard. Every task is `AFK`; Vitest +
supertest drives the acceptance gates autonomously from `./app/`.

## Verification environment

`node-test` — Vitest run from `./app/` via `npm test`. Build executes
the suite autonomously; no manual browser walkthrough required. The
`npm start` boot check is a `cli-shell` sub-assertion (start the
process, curl `http://localhost:3000/api/bookmarks`, shut it down),
folded into the same Node-based gate.

## Task summary

| ID    | Title                                                                 | Type |
|-------|------------------------------------------------------------------------|------|
| T-001 | Bootstrap `./app/` workspace (package.json, tsconfig, scripts, layout) | AFK  |
| T-002 | SQLite persistence layer — schema + repo (`db.ts`)                     | AFK  |
| T-003 | Validation helpers (`validate.ts`)                                     | AFK  |
| T-004 | Express skeleton + static + error mapper (`app.ts`, `routes.ts`)       | AFK  |
| T-005 | `GET /api/bookmarks` — list newest-first                               | AFK  |
| T-006 | `POST /api/bookmarks` — validate, reject duplicates, return 201        | AFK  |
| T-007 | `DELETE /api/bookmarks/:id` — 204 on success, 404 when missing         | AFK  |
| T-008 | Frontend bundle wiring (esbuild, `index.html`, `styles.css`)           | AFK  |
| T-009 | Frontend list rendering + empty state + open-in-new-tab                | AFK  |
| T-010 | Frontend create form + inline error handling                           | AFK  |
| T-011 | Frontend delete control + re-fetch                                     | AFK  |
| T-012 | `npm start` entrypoint + workspace-isolation smoke guard               | AFK  |

Total: 12 tasks. AFK: 12. HITL: 0.

## Layer coverage

- **Build / workspace tooling:** T-001, T-008, T-012 (package.json scripts,
  tsconfig, esbuild config, gitignore, isolation guard).
- **Persistence (SQLite):** T-002 (schema, prepared statements, `DuplicateUrlError`,
  `NotFoundError`, file round-trip).
- **Pure validation:** T-003 (`validateBookmarkInput`).
- **HTTP layer (Express):** T-004 (`buildApp`, static, JSON, error mapper),
  T-005 / T-006 / T-007 (routes).
- **Frontend (vanilla TS + DOM):** T-008 (bundle/HTML/CSS),
  T-009 (`render.ts`, list/empty-state, anchors), T-010 (form submit +
  `api.ts` create wrapper + inline error slot), T-011 (delete handler + re-fetch).
- **Process entrypoint:** T-012 (`src/server/index.ts`, file-backed DB,
  `listen(3000)`, smoke check).

## Acceptance gates

The gates that must be green before Plan→Build is considered satisfied:

1. **`npm start` boots** from `./app/` and serves both `GET /` (HTML) and
   `GET /api/bookmarks` (JSON) on `http://localhost:3000`. Validated as a
   `cli-shell` sub-step inside `node-test`.
2. **`npm test` is green** from `./app/`: Vitest suite (validate / db /
   api) passes, including the file-backed round-trip test.
3. **All four user stories satisfied:**
   - US-001 covered by T-002, T-003, T-006, T-010.
   - US-002 covered by T-002, T-005, T-009.
   - US-003 covered by T-009.
   - US-004 covered by T-002, T-007, T-011.
4. **Workspace isolation:** every deliverable file lives under
   `.loom/baseline-1779002783-1/app/`. T-012 explicitly asserts the
   repo root, `orchestrator/`, and sibling workspaces remain untouched.
