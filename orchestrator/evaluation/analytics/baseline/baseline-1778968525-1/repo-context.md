# Repo Context — baseline-1778968525-1

## Purpose

Seed-relevant slice of the host-repo digest. See `.loom/.cache/repo-digest.md`
for the stable cross-fabric facts (host layout, fabric isolation rule,
greenfield convention). This file captures only what THIS fabric needs.

## Seed summary

Greenfield, single-user, local-only "Bookmarks" web app. No existing code to
extend — built from scratch inside the fabric workspace. The HARNESS-DIRECTIVE
at the top of `seed.md` pins all deliverable files (package.json, tsconfig,
src, tests, SQLite file, node_modules, build output) to `./app/` relative to
the seed file's location, i.e. `.loom/baseline-1778968525-1/app/`.

## Workspace path resolution

- Seed: `.loom/baseline-1778968525-1/seed.md`
- Deliverable root: `.loom/baseline-1778968525-1/app/`
- `npm start` and `npm test` must be runnable from `app/`.

## Stack (pinned by seed — not a decision point)

- TypeScript end-to-end.
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the server.
- Frontend: HTML + CSS + vanilla TypeScript, bundled to one JS file via
  `esbuild`. No React / Vue / Svelte. No SPA framework.
- Tests: Vitest.
- One-command boot: `npm start` → http://localhost:3000 serving the UI from
  the same origin.
- One-command test: `npm test`.

## Prior art in this repo

None. This is a greenfield fabric — the orchestrator repo (TypeScript pnpm
workspace under `ui/`) is unrelated to this app and MUST NOT be imported from.
Per the digest's fabric-isolation rule, fabrics live under `.loom/<project>/`
as independent codebases.

## Files likely to be created (Plan/Build phase, not Spec)

- `app/package.json`, `app/tsconfig.json`, `app/.gitignore`
- `app/src/server/` — Express handlers, SQLite wrapper, schema bootstrap
- `app/src/web/` — vanilla TS UI source, esbuild entrypoint
- `app/public/` — index.html, CSS, built JS bundle output
- `app/tests/` — Vitest suites
- `app/data/bookmarks.sqlite` (or co-located with server file as the seed
  phrases it: "file on disk next to the server")

## Out-of-repo facts grilling must resolve

These can't be answered by inspecting code (none exists yet). They are the
five questions the seed explicitly asks the user to be grilled on:

1. Tags/categories vs. flat list.
2. Duplicate-URL handling (reject / merge / allow).
3. Search box vs. chronological-list-only.
4. Editability of saved bookmarks after creation.
5. Sort order beyond newest-first.

## Constraints inherited from seed (not from the codebase)

- Local-only, single user, no auth, no deploy target.
- No telemetry, analytics, service worker, PWA manifest, or dark mode
  toggle unless dark mode falls out of CSS for free.
- "Clean four-feature app" — surface stays small; nice-to-haves are out.
