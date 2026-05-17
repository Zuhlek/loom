# Repo context — baseline-1779002783-1

## Verdict

**Greenfield workspace. No prior art consulted.** The seed builds a brand-new
local-only "Bookmarks" web app from scratch, with the HARNESS-DIRECTIVE
explicitly pinning every deliverable under `./app/` relative to the seed
(i.e. `.loom/baseline-1779002783-1/app/`). The host repo is the Loom
orchestrator itself; none of its code is reusable by — or should be touched
by — this project.

## Cross-reference

See `.loom/.cache/repo-digest.md` for stable orchestrator-repo facts. The
digest is informational only for this project; nothing in it is a dependency
of the bookmarks app build.

## Build target

- Workspace root for deliverables: `.loom/baseline-1779002783-1/app/`
- `package.json`, `tsconfig.json`, `node_modules`, source, tests, SQLite
  file, esbuild output — all live inside `./app/`.
- `npm start` and `npm test` are invoked from `./app/`.
- Nothing outside `./app/` is written by Build.

## Integration points

None. The app is single-process, single-origin, single-user, local-only.
No external services, no auth, no deploy. The only "integration" is
`better-sqlite3` against a file on disk colocated with the server.

## Out-of-repo facts grilling needs

The seed itself enumerates the five open decisions (tags/flat, dup handling,
search, editability, sort). No further out-of-repo lookups required —
these are all user-preference calls, not codebase-grounded ones.
