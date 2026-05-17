---
project: baseline-1779002783-1
created: 2026-05-17
---

# Spec — Bookmarks

## What we're building

A tiny local-only "Bookmarks" web app that runs on the user's laptop. Single
user, no auth, no deploy. The user saves URLs with a title, sees them in a
chronological list, opens each one in a new tab, and deletes the ones they
no longer want. Four features, nothing else.

The app is a single Node + Express process serving both a JSON API and the
plain HTML/CSS/TypeScript frontend from the same origin on
`http://localhost:3000`. Storage is a `better-sqlite3` file on disk next to
the server. The frontend is compiled to a single JS bundle via `esbuild`.
Tests run under Vitest.

## Users and value

- **User:** the developer / power-user on a single laptop, running the app
  locally to keep an ad-hoc list of links they want to revisit. Not shared,
  not multi-tenant, not deployed.
- **Value:** a one-glance list of saved URLs that survives browser-bookmark
  reorganisation, lives outside the browser, and is greppable on disk via
  the SQLite file. Lighter than a hosted service, more durable than a
  scratch text file.

## Scope

- Save a bookmark by submitting a URL + title.
- See all saved bookmarks in a single chronological list (newest first).
- Open any bookmark in a new browser tab.
- Delete any bookmark the user no longer wants.
- Reject duplicate URLs with an inline error at save time.
- Single Express process, single origin, SQLite file on disk colocated
  with the server.
- `npm start` boots the server on `http://localhost:3000`.
- `npm test` runs the Vitest suite.

## Out of scope

- Tags, categories, folders, or any organising scheme beyond the flat list. (Q01)
- Editing a bookmark's title or URL after creation. (Q04)
- Search, filter, or any non-chronological retrieval. (Q03)
- Sort orders other than newest-first. (Q05)
- Merging or silently overwriting duplicate URLs. (Q02)
- Authentication, multi-user, sharing, sync, deploy.
- Telemetry, analytics, service worker, PWA manifest.
- Dark-mode toggle (unless it falls out of CSS-only `prefers-color-scheme` for free).
- Any framework on the frontend (no React, no Vue, no Svelte).
- Migration tooling, schema versioning beyond a single `CREATE TABLE IF NOT EXISTS`.

## User stories

### US-001: Save a URL with a title
<!-- loom:story id=US-001 status=answered -->

**Story:** As the local user, I want to save a URL with a title via the
app's form, so that the link is persisted to my bookmarks list and
survives restarts.

**Supporting decisions:** Q01 (flat list), Q02 (reject duplicates)

**Acceptance criteria:**
1. When the user submits the new-bookmark form with a non-empty title and a syntactically valid URL, the system SHALL persist a new row in the `bookmarks` SQLite table and return a 2xx response.
2. When the user submits the form with a URL that already exists in the `bookmarks` table, the system SHALL reject the submission with a 4xx response and display an inline error in the UI without creating a new row.
3. If the submitted URL is empty or syntactically invalid, then the system SHALL reject the submission with a 4xx response and display an inline error without creating a new row.
4. If the submitted title is empty, then the system SHALL reject the submission with a 4xx response and display an inline error without creating a new row.

<!-- loom:story-end id=US-001 -->

### US-002: View all saved bookmarks in a list
<!-- loom:story id=US-002 status=answered -->

**Story:** As the local user, I want to see every saved bookmark in a
single chronological list, so that I can scan my saved links at a glance.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first)

**Acceptance criteria:**
1. When the user loads the app at `http://localhost:3000`, the system SHALL render every persisted bookmark in a single list view.
2. The system shall order the rendered list by `created_at` descending (newest first).
3. While the bookmarks table is empty, the system SHALL render an empty-state message instead of an empty list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the local user, I want to click a saved bookmark and have
it open in a new browser tab, so that I do not lose my place in the
bookmarks list.

**Acceptance criteria:**
1. When the user clicks the title link of a bookmark row, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall render each bookmark link with `target="_blank"` and `rel="noopener noreferrer"`.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark
<!-- loom:story id=US-004 status=answered -->

**Story:** As the local user, I want to delete a bookmark I no longer
want, so that my list stays focused on links I still care about.

**Supporting decisions:** Q04 (immutable; delete is the only removal path)

**Acceptance criteria:**
1. When the user activates the delete control on a bookmark row, the system SHALL remove that row from the `bookmarks` table and from the rendered list.
2. When a delete is performed, the system SHALL return a 2xx response on success.
3. If the targeted bookmark id does not exist, then the system SHALL return a 4xx response and leave the table unchanged.

<!-- loom:story-end id=US-004 -->

## Constraints

- **Workspace isolation (harness):** every deliverable file (`package.json`,
  `tsconfig.json`, source, tests, build output, `node_modules`, the SQLite
  database file) MUST live inside `./app/` relative to the workspace seed,
  i.e. under `.loom/baseline-1779002783-1/app/`. Nothing is written to the
  repo root, to `orchestrator/`, or to any sibling workspace.
- **Stack pinned, no substitutions:**
  - TypeScript everywhere (backend + frontend, no plain JS source files).
  - Backend: Node + Express, single process.
  - Storage: `better-sqlite3` against a file on disk next to the server.
  - Frontend: plain HTML + CSS + vanilla TypeScript, compiled to one JS
    bundle via `esbuild`. No frontend framework.
  - Tests: Vitest.
- **Run commands:**
  - `npm start` (run from `./app/`) boots the server on
    `http://localhost:3000` and serves the UI from the same origin.
  - `npm test` (run from `./app/`) runs the Vitest suite.
- **Single origin:** the API and the static frontend assets are served from
  the same Express process on the same port — no CORS, no proxy, no
  separate dev server.
- **No external network calls at runtime.** The app is local-only; no
  telemetry, no analytics, no remote fetch.
- **URL uniqueness:** the `bookmarks` table SHALL enforce a UNIQUE
  constraint on `url`, matching the reject-on-duplicate behaviour (Q02).
- **Surface discipline:** no features beyond the four named in
  `## Scope` are added "for free." Telemetry, analytics, service worker,
  PWA manifest, dark-mode toggle, edit, search, tags, alt-sort are all
  out of scope.

## Open ambiguity

*(none — all five seed-flagged decisions resolved via Q01–Q05. The
remaining unknowns are implementation choices owned by Design, not
intent ambiguities.)*
