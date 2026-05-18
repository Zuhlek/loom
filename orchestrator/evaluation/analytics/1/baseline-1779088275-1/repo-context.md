# Repo Context — baseline-1779088275-1

Seed-relevant slice. See `.loom/.cache/repo-digest.md` for stable cross-fabric facts about the host `loom` repo and the eval harness.

## Seed nature

This seed is an eval-harness **greenfield** baseline: build a tiny local-only "Bookmarks" web app from scratch. The seed prescribes the stack (TypeScript, Node + Express, better-sqlite3, esbuild, Vitest) and the runtime contract (`npm start` boots `http://localhost:3000`, `npm test` runs the test suite).

## Workspace isolation directive (hard constraint, surface in Constraints)

Every deliverable for this run MUST live under `./app/` relative to the seed location — i.e. `.loom/baseline-1779088275-1/app/`. `package.json`, `tsconfig.json`, `node_modules`, the SQLite file, source, tests, build output, everything `npm` writes. The host repo root, `orchestrator/`, and sibling workspaces are off-limits. Parallel baseline runs depend on this isolation.

## Prior art

- No existing source under the workspace (`.loom/baseline-1779088275-1/app/` does not yet exist). This is a clean start.
- The host `loom` repo's own `ui/` and `orchestrator/` directories are NOT integration points for this seed; they are unrelated host plumbing and explicitly out of scope by the isolation directive.
- The eval harness has run similar baselines historically; nothing about prior baseline runs leaks into this workspace.

## Integration points

- None outside the workspace. The bookmarks app is single-process, single-user, runs on `localhost:3000`, serves UI and JSON from the same origin.
- The only external surface is the user's browser tab opening the served UI on `http://localhost:3000`.

## Files likely to be created (under `./app/` only)

- `package.json`, `tsconfig.json`, `.gitignore`
- Server: TypeScript Express app (single entry, single process), `better-sqlite3` data layer, static asset serving for the frontend bundle.
- Frontend: one HTML entry, one CSS file, vanilla TypeScript sources compiled by `esbuild` into one JS bundle served from the same origin.
- Tests: Vitest specs (server-side API tests at minimum; frontend testability depends on framing decisions during Branching).
- SQLite database file on disk, alongside the server entry.

## Out-of-repo / out-of-workspace facts grilling needs

The seed already enumerates the open product questions. From the answer queue (`.answers.yaml`):

- Q01 — bookmarks have tags/categories or flat list. Answer queued: "Flat list".
- Q02 — duplicate URL handling. Answer queued: "Reject duplicate URLs with an inline error".
- Q03 — search box. Answer queued: "Chronological list only".
- Q04 — editability. Answer queued: "Immutable once added".
- Q05 — sort order. Answer queued: "Newest-first only".

These are Branching decisions; Foundation needs essentially zero grilling because: there is no existing system, the team is one person ("Single user, runs on my laptop"), success is the four user-observable features running locally, and the constraint envelope is fully prescribed by the seed (stack pinned, no auth, no deploy, no telemetry).

## Cross-references

- Stable repo facts: `.loom/.cache/repo-digest.md`.
- Spec grilling discipline: `orchestrator/weave/phases/spec/methods/grilling.md`.
- Question categories: `orchestrator/weave/phases/spec/methods/categories.md`.
- Story / EARS rules: `orchestrator/weave/phases/spec/methods/stories.md`.
