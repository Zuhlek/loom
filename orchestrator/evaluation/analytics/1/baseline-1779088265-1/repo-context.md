# Repo Context — baseline-1779088265-1

Seed-relevant slice for this fabric. Cross-references `.loom/.cache/repo-digest.md` for shared facts.

## Seed nature

Greenfield "build from scratch" fabric. A local-only single-user **Bookmarks** web app. This codebase will NOT extend or import from the loom orchestrator (see digest §"Host repo identity"). It is an independent codebase that happens to be tracked under `.loom/<project>/app/`.

## Workspace location (hard constraint from seed)

All deliverable files MUST land under:

```
.loom/baseline-1779088265-1/app/
```

Everything — `package.json`, `tsconfig.json`, source, tests, build output, `node_modules`, the SQLite DB file, anything `npm` writes — goes there. The seed makes this a non-negotiable harness constraint and asks Spec to surface it under `## Constraints`. Per digest §"Conventions", this isolation is consistent with how loom-managed fabrics work: fabric workspaces are isolated and free to choose their own stack.

## Prior art in this repo for this stack

None. The orchestrator's `ui/` workspace is a pnpm UI for loom itself and is NOT consumed by fabrics (digest §"Top-level layout"). There is no shared Express + SQLite scaffold to extend. The fabric stands up its own `package.json` from scratch.

## Integration points

None outside the fabric workspace. The app is single-process, runs on `http://localhost:3000`, serves UI from the same origin, and persists to a local SQLite file on disk. No external services, no auth, no deploy.

## Files likely to be edited / created (Design will firm these up)

All under `.loom/baseline-1779088265-1/app/`:

- `package.json`, `package-lock.json`, `tsconfig.json`
- `src/server/` — Express server + SQLite access (Node + TS).
- `src/client/` — vanilla TS that compiles via `esbuild` into one JS bundle.
- `src/shared/` — types shared between server and client (e.g. the `Bookmark` shape).
- `public/` (or equivalent) — `index.html`, CSS, bundled JS output.
- `test/` — Vitest tests.
- The SQLite file lives next to the server (per seed).

Exact layout is a Design decision; Spec only fixes the workspace root.

## Stack — pinned by the seed, NOT a Spec decision

- TypeScript everywhere.
- Node + Express, single process.
- `better-sqlite3` for storage, SQLite file on disk.
- Vanilla HTML + CSS + TS frontend, bundled by `esbuild`. No framework.
- Vitest for tests.
- `npm start` boots the server on `:3000`; `npm test` runs the suite.

The seed explicitly says "no substitutions" — Spec does NOT re-open stack choices.

## Out-of-repo facts grilling needs from the user

The seed enumerates exactly five open product decisions:

1. Tags/categories vs flat list (Q01).
2. Duplicate-URL handling — reject / merge / allow (Q02).
3. Search box vs chronological list only (Q03).
4. Bookmark editability after creation (Q04).
5. Sort orders beyond newest-first (Q05).

Plus an explicit anti-scope directive: no telemetry, no analytics, no service worker, no PWA manifest, no dark-mode toggle. Spec surfaces those as Out-of-scope items, not questions.

## What this context does NOT establish

- Concrete file layout inside `app/` — Design decides.
- SQLite schema — Design decides (Spec captures the bookmark fields needed to satisfy stories).
- API surface (route paths, payload shapes) — Design decides.
