# Project context — baseline-1779428627-1

## Summary

Build a tiny, single-user local-only Bookmarks web app. The user can save URLs with titles, view them in a chronological list, and delete bookmarks. No auth, no deploy, no network services — everything runs on localhost with SQLite storage.

## Workspace boundary

**All deliverable files must be created inside `.loom/baseline-1779428627-1/app/`** — this is the constraint set by the harness to ensure parallel baseline runs do not collide. The workspace is completely isolated; do not write anything to the repo root, `orchestrator/`, `ui/`, or sibling workspaces.

## Stack constraints (pinned by seed)

- **Language**: TypeScript everywhere (server + client)
- **Backend**: Node + Express, single process
- **Storage**: SQLite via `better-sqlite3`, file on disk next to the server
- **Frontend**: Plain HTML + CSS + vanilla TypeScript, compiled to one JS bundle via `esbuild`. **No React, Vue, or any framework.**
- **Tests**: Vitest
- **Commands**:
  - `npm start` — boots the Express server on `http://localhost:3000`, serves the UI from the same origin
  - `npm test` — runs Vitest

The deliverable is a brand-new app skeleton built entirely inside the workspace. Do not import or modify anything from `orchestrator/` or `ui/`.

## Open questions for Spec to clarify

The seed explicitly asks for user decisions on five design points:

1. **Tags/categories** — should bookmarks have tags, categories, or just a flat list?
2. **Duplicate handling** — if the user saves a URL already in the system, should it reject, merge, or allow duplicates?
3. **Search** — is a chronological list enough, or do you need a search box?
4. **Edit capability** — can the user edit a bookmark's title/URL after creation, or are they immutable once added?
5. **Sort order** — do you need any sort order other than newest-first?

## Pre-staged answers (`.answers.yaml`)

The `.answers.yaml` file has been pre-staged with opinionated baseline answers that favor minimal surface:

- **flat list** (no tags or categories)
- **reject duplicates** (same URL cannot be saved twice)
- **no search** (chronological list only)
- **immutable** (no edit after creation)
- **newest-first only** (single sort order)

These answers are baked into the eval harness to support non-interactive baseline runs. Spec should surface them as constraints in `spec.md` if the user does not override them.

## Feature scope

Keep the surface minimal. Ship a clean four-feature app:
- Save a URL with a title
- View all bookmarks in one list
- Open a bookmark in a new tab
- Delete a bookmark

No nice-to-haves not explicitly asked for:
- No telemetry, analytics, or service worker
- No PWA manifest
- No dark mode toggle unless it falls out of CSS for free
- No missing-feature placeholders or future-extension stubs

## Notes on the Loom orchestrator

This project has **no relation** to the orchestrator's own TypeScript code. It is a completely separate app skeleton that happens to live under `.loom/baseline-1779428627-1/app/`. The five phase agents (Spec, Design, Plan, Build, Review) will orchestrate its development, but they do not import, depend on, or modify anything in `orchestrator/` or `ui/`.
