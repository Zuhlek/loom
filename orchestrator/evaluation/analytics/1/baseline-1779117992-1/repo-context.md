---
project: baseline-1779117992-1
created: 2026-05-18
---

# Repo Context — Bookmarks (greenfield)

See `.loom/.cache/repo-digest.md` for stable cross-fabric facts (host repo identity, layout, conventions). This file captures only the seed-relevant slice.

## What this fabric is

Greenfield, local-only "Bookmarks" web app. Independent codebase living under
`.loom/baseline-1779117992-1/app/`. Shares no code with the loom orchestrator
or its `ui/` workspace (see digest §"Conventions").

## Workspace location (hard constraint from seed)

All deliverables (source, tests, build output, `package.json`, `tsconfig.json`,
`node_modules`, the SQLite file) live under:

```
.loom/baseline-1779117992-1/app/
```

`npm start` and `npm test` MUST be runnable from `./app/`. Parallel baseline
runs use adjacent workspaces and overwrite each other if this is violated.
This is the harness's only structural constraint on the fabric.

## Prior art inside the host repo

None relevant. The host repo is the orchestrator itself; there is no existing
"Bookmarks" code, no shared SQLite helpers, no shared Express setup. The
fabric scaffolds from scratch.

## Integration points

None. Single process, single user, runs on localhost. No external services,
no auth, no telemetry, no deploy target.

## Files likely to be edited (preview)

Inside `.loom/baseline-1779117992-1/app/`:

- `package.json` — declares `start` and `test` scripts, deps (`express`,
  `better-sqlite3`, `vitest`, `esbuild`, `typescript`, `@types/*`).
- `tsconfig.json` — TS compile config.
- `src/server.ts` — Express bootstrap, routes, static serving.
- `src/db.ts` — `better-sqlite3` open + schema migration on boot.
- `src/routes/bookmarks.ts` — REST endpoints.
- `src/web/index.html`, `src/web/styles.css`, `src/web/main.ts` — UI.
- `esbuild.config.*` — bundles `src/web/main.ts` → one JS file served by Express.
- `tests/*.test.ts` — Vitest specs.
- `bookmarks.sqlite` — runtime SQLite file next to the server (gitignored).

Concrete layout is a Design-phase decision; this is preview only.

## Out-of-repo facts grilling needs to ask

The seed enumerates five explicit branching questions and asks the agent NOT
to silently choose. These map 1:1 onto Q01–Q05 in `decisions.md`:

1. Tags / categories vs flat list (Q01)
2. Duplicate-URL handling (Q02)
3. Search box presence (Q03)
4. Edit after creation (Q04)
5. Sort order beyond newest-first (Q05)

No other ambiguity rises above the noise floor; the stack is fully pinned by
the seed and the run command surface is fully pinned by the seed.

## Stack (fixed by seed — not negotiable)

- TypeScript everywhere
- Node + Express, single process
- SQLite via `better-sqlite3`, file on disk next to the server
- Vanilla HTML/CSS/TS, bundled via `esbuild` (no framework)
- Vitest
- `npm start` → server on `http://localhost:3000`, UI same-origin
- `npm test` → Vitest
