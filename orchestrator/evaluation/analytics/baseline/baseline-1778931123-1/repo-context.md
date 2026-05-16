# Repo Context — baseline-1778931123-1 (Bookmarks)

## Seed-relevant slice

Cross-ref: `.loom/.cache/repo-digest.md` for host repo identity. This fabric is a
**greenfield** project — no prior art in the host repo applies.

## Workspace location

- Fabric workspace: `.loom/baseline-1778931123-1/`
- All deliverables MUST live under `.loom/baseline-1778931123-1/app/` per the
  harness directive in `seed.md` (lines 1–7). Repo root, `orchestrator/`, and
  sibling workspaces are off-limits for fabric writes.

## Stack (locked by seed, not by grilling)

The seed locks the stack — no Branching questions needed here:

- TypeScript everywhere.
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the server.
- Frontend: plain HTML/CSS + vanilla TypeScript, bundled to one JS file via
  `esbuild`. NO React / Vue / framework.
- Tests: Vitest.
- Entry points: `npm start` boots server on `http://localhost:3000` and serves
  the UI from the same origin; `npm test` runs Vitest.

## Integration points

None. Single-user, local-only, no auth, no deploy, no external services.

## Out-of-repo facts grilling needs to surface

The seed enumerates them explicitly:

1. Tags / categories vs flat list.
2. Duplicate-URL handling (reject / merge / allow).
3. Search box vs chronological list.
4. Editability of saved bookmarks.
5. Sort order beyond newest-first.

## Files likely to be edited (post-Design)

To be decided in Design. Anticipated rough shape (informational only):

- `app/package.json`, `app/tsconfig.json`
- `app/src/server.ts` (Express + SQLite handlers)
- `app/src/client/main.ts` (vanilla TS UI)
- `app/src/client/index.html`, `app/src/client/styles.css`
- `app/test/*.test.ts` (Vitest)
- `app/bookmarks.sqlite` (runtime, gitignored)
