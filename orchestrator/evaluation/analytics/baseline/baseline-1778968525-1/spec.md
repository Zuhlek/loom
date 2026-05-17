---
project: baseline-1778968525-1
created: 2026-05-16
---

# Spec — baseline-1778968525-1

## What we're building

A tiny, local-only "Bookmarks" web app. A single user runs it on their
laptop via `npm start`, opens `http://localhost:3000`, and gets a single
page where they can save a URL with a title, see all saved bookmarks in a
chronological list, open any bookmark in a new tab, and delete bookmarks
they no longer want. Bookmarks are stored in a local SQLite file. No
authentication, no deploy target, no multi-user concerns. The stack is
TypeScript end-to-end: Node + Express backend, vanilla TypeScript
frontend bundled via `esbuild`, Vitest for tests.

## Users and value

- **Primary user:** the developer running the app on their own laptop —
  one person, one machine, no accounts.
- **Value:** keep a personal, durable, offline-first list of URLs worth
  revisiting, without depending on a browser's built-in bookmarks bar or
  a third-party service. A bookmark survives browser reinstalls because
  it lives in a SQLite file the user owns.

## Scope

- Save a new bookmark (title + URL) via a form on the single page.
- List all saved bookmarks in newest-first order on the same page.
- Open any saved bookmark in a new browser tab (target=`_blank`,
  `rel="noopener noreferrer"`).
- Delete a saved bookmark from the list.
- Reject attempts to save a URL that already exists, with an inline
  error message; the existing bookmark remains untouched.
- Persist bookmarks in a SQLite file on disk via `better-sqlite3`.
- Serve the UI (HTML + CSS + bundled JS) from the same Express origin.
- `npm start` boots the server on `http://localhost:3000`.
- `npm test` runs the Vitest suite.

## Out of scope

- Authentication, accounts, sessions, multi-user, sharing.
- Deployment, hosting, remote access, HTTPS, reverse proxy.
- Tags, categories, folders, or any per-bookmark grouping metadata.
- Editing a bookmark's title or URL after creation (Q04 → immutable).
- A search box, full-text search, or any in-app filtering UI (Q03).
- Sort orders other than newest-first (Q05). No alphabetical toggle, no
  manual drag-reorder.
- Merging duplicate URLs or allowing duplicate URLs in the list (Q02).
- Telemetry, analytics, error reporting, service workers, PWA manifest,
  offline app cache, push notifications.
- A dark-mode toggle (system-driven dark mode that falls out of CSS for
  free is acceptable but not a goal).
- Import / export of bookmarks (no `.html` import, no JSON export).
- URL preview cards, favicon fetching, link health checks, or any
  outbound network call from the server.
- Any front-end framework (no React, Vue, Svelte, htmx, Alpine, jQuery).

## User stories

### US-001: Save a bookmark with title and URL
<!-- loom:story id=US-001 status=active -->

**Story:** As the single user of my local bookmarks app, I want to save
a URL together with a title, so that I can revisit the page later
without remembering its address.

**Supporting decisions:** Q01 (flat list), Q02 (duplicate handling)

**Acceptance criteria:**
1. When the user submits the new-bookmark form with a non-empty title and a syntactically valid URL, the system SHALL persist a new bookmark row to SQLite and render it at the top of the list.
2. If the submitted URL is missing or syntactically invalid, then the system SHALL reject the submission with an inline validation message and SHALL NOT write to SQLite.
3. If the submitted title is empty or whitespace-only, then the system SHALL reject the submission with an inline validation message and SHALL NOT write to SQLite.
4. If the submitted URL exactly matches a URL already stored, then the system SHALL reject the submission with an inline "URL already saved" message and SHALL leave the existing row unchanged.

<!-- loom:story-end id=US-001 -->

### US-002: View all saved bookmarks newest-first
<!-- loom:story id=US-002 status=active -->

**Story:** As the single user, I want to see every bookmark I have
saved on the same page in newest-first order, so that the most recently
captured page is always at the top.

**Supporting decisions:** Q01 (flat list), Q05 (newest-first only)

**Acceptance criteria:**
1. When the page is loaded, the system SHALL fetch all stored bookmarks and render them as a single chronological list ordered by creation timestamp descending (newest first).
2. The system SHALL render each list entry with at minimum its title and URL.
3. When a new bookmark is saved during the current session, the system SHALL prepend it to the visible list without requiring a full page reload.
4. While no bookmarks exist, the system SHALL render an empty-state message in place of the list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=active -->

**Story:** As the single user, I want to click a saved bookmark and
have it open in a new browser tab, so that I keep the bookmarks app
itself open while I read the page.

**Acceptance criteria:**
1. When the user clicks a bookmark entry's title or URL, the system SHALL open the bookmark's URL in a new browser tab.
2. The system SHALL render bookmark links with `target="_blank"` and `rel="noopener noreferrer"` to prevent the opened page from accessing the bookmarks app window.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a saved bookmark
<!-- loom:story id=US-004 status=active -->

**Story:** As the single user, I want to delete a bookmark I no longer
want, so that my list does not accumulate entries I will not revisit.

**Acceptance criteria:**
1. When the user clicks a bookmark entry's delete control, the system SHALL remove the corresponding row from SQLite and remove the entry from the visible list.
2. If the SQLite delete fails for any reason, then the system SHALL leave the visible list unchanged and surface an inline error message.

<!-- loom:story-end id=US-004 -->

## Constraints

These are envelope conditions and universal invariants — not
user-action-shaped stories.

- **Workspace isolation (harness constraint, do not relax).** All
  deliverable files for this run — `package.json`, `tsconfig.json`,
  source code, tests, build output, `node_modules`, the SQLite file,
  anything `npm` writes — MUST be created inside `./app/` relative to
  this seed file's location (i.e. inside the `.loom/<project>/`
  workspace). Concretely: if this seed lives at
  `.loom/baseline-2026-05-15-1/seed.md`, every deliverable goes under
  `.loom/baseline-2026-05-15-1/app/`. Never write deliverable files to
  the repo root, to `orchestrator/`, or to any sibling workspace. The
  `npm start` and `npm test` commands declared below MUST be runnable
  from `./app/`. Multiple baseline runs execute in adjacent workspaces
  and will overwrite each other if this is violated.
- **Stack pinning.** TypeScript everywhere. Backend: Node + Express,
  single process. Storage: SQLite via `better-sqlite3`, file on disk
  next to the server. Frontend: plain HTML + CSS + vanilla TypeScript
  bundled into one JS file via `esbuild`. No React, no Vue, no other
  framework. Tests: Vitest. No substitutions on any of these.
- **One-command run.** `npm start` (run from `app/`) SHALL boot the
  Express server on `http://localhost:3000` and serve the UI from the
  same origin.
- **One-command test.** `npm test` (run from `app/`) SHALL run the
  Vitest suite to completion.
- **Local-only operation.** The server SHALL bind to localhost only and
  SHALL make no outbound network requests at runtime.
- **No persistence beyond SQLite.** All bookmark state SHALL live in the
  on-disk SQLite file; no in-memory-only or external-service state.
- **URL uniqueness invariant.** The `bookmarks` table SHALL enforce
  uniqueness on the URL column at the schema level (e.g. `UNIQUE(url)`).
- **Same-origin UI serving.** The HTML, CSS, and bundled JS SHALL be
  served from the same Express process that hosts the API; no separate
  static-asset server or CDN.
- **Minimum surface.** No feature beyond the four canonical operations
  (save, list, open, delete) and their inline validation. No
  telemetry, analytics, service worker, PWA manifest, or dark-mode
  toggle. System-driven dark mode emerging from baseline CSS is
  acceptable but not a goal.

## Open ambiguity

None. The five branching questions the seed explicitly asked to be
grilled on (Q01–Q05) were resolved via the non-interactive answer
queue. The remaining scope is fully constrained by the seed.
