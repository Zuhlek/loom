---
project: baseline-1779088265-1
phase: plan
created: 2026-05-18
---

# Plan — baseline-1779088265-1 (Bookmarks)

Work graph that turns the Design's three-layer Node + Express + SQLite + vanilla-TS structure into an executable, vertically-sliced set of tasks. Each task delivers a thin slice of one or more user stories' acceptance criteria. Build picks ready work from `board.md` and executes against `tests.md`.

## Verification environment

`node-test`

Build executes the acceptance gates declared in `tests.md` autonomously via Vitest (`npm test` from `.loom/baseline-1779088265-1/app/`). Server-side tests use `better-sqlite3` against an in-memory database (`:memory:`) driven through `supertest` against the exported `createApp` factory. Client-side rendering and form tests run under Vitest's `jsdom` environment. A `cli-shell` smoke step (boot the server with `npm start`, hit `GET /api/bookmarks`, kill the process) is included as the end-to-end gate; this is also executable by Build without a GUI. No `manual-browser-desktop` or `headless-browser` step is required — every gate runs in the headless Node + jsdom harness.

## Strategy

Vertical slicing along the four user stories, with a thin foundation slice first (T-001..T-003) that establishes the workspace, the data layer, and the HTTP factory. Each subsequent slice (T-004..T-007) implements one observable behaviour end-to-end (repo → route → client → DOM), so each can be reviewed and demoed independently. A final smoke / packaging slice (T-008) closes the loop on the `npm start` / `npm test` contract.

Layer key (concern boundaries inside `./app/`):

| Layer | Responsibility |
| --- | --- |
| `workspace` | `package.json`, tsconfigs, esbuild config, scripts |
| `db` | `better-sqlite3` open + schema migration |
| `repo` | All SQL; pure data access against the `Database` handle |
| `routes` | HTTP handlers; request validation; response shape |
| `app` | Express app factory; middleware; error middleware; static serving |
| `boot` | `server/index.ts` — process lifecycle, port binding, db path |
| `client-api` | `fetch` wrappers + typed errors |
| `client-render` | DOM construction for list, empty state, form errors |
| `client-form` | Form state machine + client-side validation |
| `client-boot` | `main.ts` wiring |
| `static` | `index.html`, `styles.css` |
| `shared-types` | Cross-tier `Bookmark`, `CreateBookmarkInput`, `ApiErrorBody` |
| `smoke` | Cross-cutting end-to-end check that boots the server |

## Task ladder (summary)

| ID   | Title                                                    | Type | Blocks on        | Stories          |
| ---- | -------------------------------------------------------- | ---- | ---------------- | ---------------- |
| T-001 | Bootstrap workspace, tsconfigs, scripts, shared types   | AFK  | —                | US-001..US-004   |
| T-002 | Open SQLite + run schema migration                      | AFK  | T-001            | US-001, US-002   |
| T-003 | Express app factory + JSON middleware + error handler   | AFK  | T-001            | US-001..US-004   |
| T-004 | Save a bookmark end-to-end (repo + POST + form)         | AFK  | T-002, T-003     | US-001           |
| T-005 | List bookmarks newest-first end-to-end (repo + GET + render + empty state) | AFK | T-002, T-003 | US-002 |
| T-006 | Open a bookmark in a new tab (anchor rendering)         | AFK  | T-005            | US-003           |
| T-007 | Delete a bookmark end-to-end (repo + DELETE + UI)       | AFK  | T-004, T-005     | US-004           |
| T-008 | Boot process, static shell, smoke gate                  | AFK  | T-004, T-005, T-006, T-007 | US-001..US-004 |

All tasks are `AFK` — the harness is a single Coordinator with the Node toolchain; no human-in-the-loop step is needed for this surface.

## Coverage check

Every active `US-NNN` story is covered by at least one task's `satisfies-stories` field:

- US-001 → T-001 (foundation), T-003 (HTTP envelope), T-004 (the slice), T-008 (smoke)
- US-002 → T-001, T-002, T-003, T-005, T-008
- US-003 → T-006, T-008
- US-004 → T-003, T-007, T-008

No `blocked-by` edge references a non-existent task. The DAG is acyclic (the table above forms a layered topology).

## Dispatch order (Build hint)

Ready immediately: **T-001**.
After T-001: **T-002**, **T-003** (parallelisable).
After T-002 + T-003: **T-004**, **T-005** (parallelisable).
After T-005: **T-006**.
After T-004 + T-005: **T-007**.
After T-004 + T-005 + T-006 + T-007: **T-008**.

## Open ambiguity

None. Spec resolved Q01..Q05; Design ADR-001..008 pinned the structure; the workspace harness constraint is unambiguous. Plan can hand off to Build immediately.
