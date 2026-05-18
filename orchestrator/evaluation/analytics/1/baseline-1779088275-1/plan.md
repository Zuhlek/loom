---
project: baseline-1779088275-1
phase: plan
created: 2026-05-18
---

# Plan — baseline-1779088275-1

Work graph that converts the design's module structure into an executable, vertically-sliced task DAG. Every active user story (`US-001`..`US-004`) is delivered end-to-end by at least one task.

## Slicing strategy

Each behavior-bearing task is a thin vertical slice: it touches the SQL layer (or in-memory equivalent), the HTTP route, the validation pipe, the frontend API client, the frontend render, and the DOM wiring — whatever it takes to make one observable user-facing behavior work end-to-end. The single foundation task (`T-001`) is the only intentionally horizontal task; it carries no user-facing behavior on its own and is justified explicitly in its task file.

| Task | Stories | Shape |
| --- | --- | --- |
| `T-001` | foundation (no story) | Workspace scaffold + `npm start` / `npm test` contracts |
| `T-002` | US-002 | List endpoint + list/empty-state render end-to-end |
| `T-003` | US-001 | Save endpoint + add-form + inline validation/duplicate errors end-to-end |
| `T-004` | US-003 | Open-in-new-tab — anchor target wiring |
| `T-005` | US-004 | Delete endpoint + per-row delete control + idempotent no-op refresh |

## DAG

```
T-001 ── T-002 ── T-003
              \── T-004
              \── T-005
```

- `T-001` blocks every behavior-bearing task (they all need `npm test` and the source tree).
- `T-002` blocks `T-003`, `T-004`, `T-005` because they all reuse the list-render path on refetch and the anchor structure rendered by the list.
- `T-003`, `T-004`, `T-005` are independent of each other and may run in parallel once `T-002` is Done.

No cycles. Every `blocked-by` resolves to a real task ID.

## Story coverage

Asserted by the `satisfies-stories` frontmatter on each task file. Every active `US-NNN` story in `spec.md` `## User stories` is covered by at least one task:

| Story | Covered by |
| --- | --- |
| US-001 (save a URL with a title) | T-003 |
| US-002 (see all saved bookmarks in one list) | T-002 |
| US-003 (open a saved bookmark in a new tab) | T-004 |
| US-004 (delete a saved bookmark) | T-005 |

`T-001` carries no `satisfies-stories` payload — it is a foundation task that the orchestrator treats as a precondition for every story-bearing task. Its justification lives in its task file.

## Layer map

Layer names used in `touches-layers` mirror the module split from `design.md` `## System shape`:

- `tooling` — `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild` invocation, `.gitignore`
- `db` — `src/server/db.ts` (better-sqlite3 connection factory, schema bootstrap)
- `repo` — `src/server/repo.ts` (SQL surface; `DuplicateUrlError`)
- `validation` — `src/server/validation.ts` (`parseTitle`, `parseUrl`)
- `routes` — `src/server/routes.ts` (HTTP handlers, JSON error shape)
- `server` — `src/server/index.ts` (Express bootstrap, static middleware, graceful shutdown)
- `client-api` — `src/client/api.ts` (`fetch` wrappers, `ApiError`)
- `client-render` — `src/client/render.ts` (pure DOM helpers)
- `client-main` — `src/client/main.ts` (state wiring, event handlers)
- `client-html` — `public/index.html`
- `client-css` — `public/style.css`
- `tests` — `tests/**/*.test.ts` (Vitest specs)

## Verification environment

`node-test`

`npm test` (runnable from `.loom/baseline-1779088275-1/app/`) runs `tsc --noEmit` followed by `vitest run`. The Build coordinator executes this autonomously — no browser, no human-in-the-loop step is required to validate the acceptance gates declared in `tests.md`. Behavior-level tests that span the HTTP boundary use `supertest`-style probes against the Express app constructed in-process; the frontend render module is exercised against a `happy-dom` (Vitest's default) environment. The on-disk SQLite file is never opened by the test suite — repo and route tests use the `db.ts` factory with `:memory:`.

## Open ambiguity

None. The spec and design pin every user-observable surface; remaining choices (exact error-message strings, exact `esbuild` flag set, exact Vitest test names) are implementation details for Build.
