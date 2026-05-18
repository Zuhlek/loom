<!-- HARNESS-DIRECTIVE: This block is added by the eval harness, not part of the
     original Bookmarks intent. It pins where deliverable files go so parallel
     and sequential baseline runs do not collide. The Spec phase MUST treat
     these lines as constraints and surface them in spec.md `## Constraints`. -->

**Workspace isolation (harness constraint, do not relax).**
All deliverable files for this run — `package.json`, `tsconfig.json`, source code, tests, build output, `node_modules`, the SQLite file, anything `npm` writes — MUST be created inside `./app/` **relative to this seed file's location** (i.e. inside the `.loom/<project>/` workspace). Concretely: if this seed lives at `.loom/baseline-2026-05-15-1/seed.md`, every deliverable goes under `.loom/baseline-2026-05-15-1/app/`. Never write deliverable files to the repo root, to `orchestrator/`, or to any sibling workspace. The `npm start` and `npm test` commands declared below MUST be runnable from `./app/`. Multiple baseline runs execute in adjacent workspaces and will overwrite each other if this is violated.

---

Build a tiny local-only "Bookmarks" web app from scratch. Single user, runs on my laptop, no auth, no deploy.

What it should do, roughly:
- I can save a URL with a title.
- I can see all my saved bookmarks in one list.
- I can open a saved bookmark in a new tab.
- I can delete a bookmark I no longer want.

Stack — please use exactly this, no substitutions:
- TypeScript everywhere.
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the server.
- Frontend: plain HTML + CSS + vanilla TypeScript (compiled to one JS bundle via `esbuild`). No React, no Vue, no framework.
- Tests: Vitest.
- One command to run it: `npm start` should boot the server on `http://localhost:3000` and serve the UI from the same origin. One command to test: `npm test`.

Things I have not decided yet and want you to actually ask me about, not silently choose:
- Should bookmarks have tags or categories, or just a flat list?
- If I try to save a URL I already have, what should happen — reject, merge, or just allow duplicates?
- Do I need a search box, or is a chronological list enough at this size?
- Should I be able to edit a saved bookmark's title/URL after creation, or are they immutable once added?
- Do I need any sort order other than newest-first?

Keep the surface small. I would rather you ship a clean four-feature app than a sprawling one. No nice-to-haves I did not ask for. No telemetry, no analytics, no service worker, no PWA manifest, no dark mode toggle unless it falls out of CSS for free.
