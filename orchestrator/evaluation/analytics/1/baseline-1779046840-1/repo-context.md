---
project: baseline-1779046840-1
created: 2026-05-17T19:42:00Z
---

# Repo context — baseline-1779046840-1

Seed-relevant slice produced on first Spec dispatch. Cross-references
`.loom/.cache/repo-digest.md` for shared facts; only seed-touching detail
is restated here.

## Relationship to the host repo

- See `.loom/.cache/repo-digest.md` § "Host repo identity" — the host repo is
  the loom orchestrator. This fabric is **greenfield**; it ships nothing into
  the orchestrator codebase and imports no orchestrator source.
- Per the digest's "Conventions" section, fabric workspaces are isolated and
  free to pick their own stack. The seed exercises that freedom: Node +
  Express + better-sqlite3 + esbuild + vanilla TS frontend + Vitest, none of
  which appear in the host repo's tooling.

## Workspace isolation constraint (seed-pinned)

The seed's HARNESS-DIRECTIVE block pins every deliverable under
`./app/` relative to the seed file. Resolved path for this run:

```
.loom/baseline-1779046840-1/app/
```

All of the following MUST live there and nowhere else:

- `package.json`, `package-lock.json`, `tsconfig.json`, source code,
  `dist/` (or whatever esbuild emits), tests, `node_modules/`, the
  SQLite database file, anything `npm` or `esbuild` writes.

`npm start` and `npm test` MUST be runnable from `./app/`. Sibling
workspaces (e.g. `.loom/baseline-<other>/app/`) coexist; writing outside
`./app/` would clobber them or the orchestrator itself.

This appears verbatim in `spec.md` `## Constraints` as the first item.

## Prior art inside the host repo

None directly applicable. The host repo's `ui/` workspace is a pnpm
TypeScript surface but uses Next.js/React; the seed forbids any frontend
framework, so `ui/` is reference material only (not imported).

The orchestrator's own TypeScript and pnpm configurations are NOT a model
for this fabric — the fabric must use plain `npm` and its own
`tsconfig.json` inside `./app/`.

## Files this fabric will create (all under `./app/`)

Indicative; exact filenames are a Design-phase decision, not Spec's:

- `package.json` — scripts: `start`, `test`, plus whatever build/dev
  helpers fall out (e.g. `build` for esbuild).
- `tsconfig.json` — strict TS config for both server and client sources.
- Server source — Express app, route handlers, SQLite access layer,
  static-file serving for the built frontend bundle.
- Client source — `index.html`, CSS, vanilla TS entry, bundled by esbuild
  into one JS file served at the same origin.
- Tests — Vitest specs covering the API surface and any pure logic.
- SQLite file — created at server boot, lives alongside the server entry
  (e.g. `./app/bookmarks.db`); gitignored by the fabric's own `.gitignore`
  if one is needed.

## Files this fabric will NOT create

- Nothing at the repo root.
- Nothing under `orchestrator/`, `ui/`, `docs/`, or any sibling
  `.loom/<other>/` workspace.
- No Dockerfile, no CI config, no service worker, no PWA manifest, no
  telemetry, no analytics — per seed's "keep the surface small" mandate.

## Out-of-repo facts the agent did not need to ask

The seed pins every stack choice explicitly. The five "things I have not
decided yet" are all resolved by `.answers.yaml`:

- Q01 — flat list (no tags/categories).
- Q02 — reject duplicate URLs with inline error.
- Q03 — chronological list only (no search).
- Q04 — bookmarks immutable once added (no edit).
- Q05 — newest-first only.

Foundation has nothing left to ask; this fabric jumps straight to
Branching's persistence of those five answers and then Story distillation.
