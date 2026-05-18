---
project: baseline-1779088265-1
created: 2026-05-18
---

# Spec — baseline-1779088265-1 (Bookmarks)

## What we're building

A tiny local-only Bookmarks web app. It runs on the user's laptop as a single Node + Express process, persists to a SQLite file on disk, and serves a vanilla HTML / CSS / TypeScript UI from the same origin at `http://localhost:3000`. The user can save a URL with a title, see every saved bookmark in one chronological list (newest first), open a bookmark in a new browser tab, and delete a bookmark. No auth, no deploy, no remote anything.

## Users and value

- **User:** the single human operating the laptop the app runs on. Solo, trusted, no multi-user concerns.
- **Value:** a low-friction, offline-safe place to stash URLs that survives between sessions and beats both browser-native bookmarks (cluttered, sync-bound) and a flat text file (no structure, no click-to-open) for the user's specific lightweight stashing workflow.
- **"Done" looks like:** `npm start` boots the app, the user can complete all four primitives (save / list / open / delete) end-to-end, the data survives a process restart, and `npm test` passes.

## Scope

- Save a bookmark: URL + title, persisted in SQLite.
- List all bookmarks in one view, newest first, no pagination at expected size.
- Open a listed bookmark in a new browser tab (target="_blank" + rel="noopener noreferrer").
- Delete a single bookmark from the list.
- Reject duplicate URLs at save time with an inline error message; the existing bookmark is unchanged. (Q02)
- Persist data to a SQLite file on disk next to the server, via `better-sqlite3`. Survives process restarts.
- TypeScript source compiles cleanly; `npm start` runs the server on `:3000`; `npm test` runs the Vitest suite.

## Out of scope

Driven explicitly by the seed's anti-scope list and by Q01 / Q03 / Q04 / Q05:

- Tags or categories — flat list only. (Q01)
- Search box — chronological list only; users rely on browser Ctrl-F if needed. (Q03)
- Editing a bookmark's title or URL after creation; bookmarks are immutable. To "fix" one, delete and re-add. (Q04)
- Sort orders other than newest-first; no sort control in the UI. (Q05)
- Authentication, user accounts, multi-user access.
- Remote deploy, hosted mode, cloud sync, account sync.
- Telemetry, analytics, error reporting to any external service.
- Service worker, PWA manifest, offline app shell.
- Dark-mode toggle (unless it falls out of CSS for free with `prefers-color-scheme`).
- Browser extension, mobile app, desktop shell.
- Tag-based or full-text search, autocomplete, suggestions.
- Import / export (e.g. from a browser's bookmarks file).
- Pagination, infinite scroll, virtualised lists.

## User stories

### US-001: Save a Bookmark With Title and URL
<!-- loom:story id=US-001 status=answered -->

**Story:** As the laptop's single user, I want to save a URL with a title, so that I can quickly stash a page I want to revisit.

**Supporting decisions:** Q02 (duplicate handling), Q04 (immutability)

**Acceptance criteria:**
1. WHEN the user submits the save form with a non-empty URL and a non-empty title, the system SHALL persist a new bookmark row to SQLite and show it in the list on the next render.
2. IF the submitted URL is missing, malformed, or the title is empty, then the system SHALL reject the submission with an inline error and SHALL NOT write to storage.
3. IF the submitted URL exactly matches the URL of an existing bookmark, then the system SHALL reject the submission with an inline "URL already saved" error and SHALL leave the existing bookmark unchanged.
4. The system shall record a creation timestamp for every saved bookmark.

<!-- loom:story-end id=US-001 -->

### US-002: View All Bookmarks Newest First
<!-- loom:story id=US-002 status=answered -->

**Story:** As the laptop's single user, I want to see every bookmark I have saved in one chronological list, so that I can find what I recently saved without searching.

**Supporting decisions:** Q01 (flat list), Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. WHEN the user loads the app's main page, the system SHALL render every persisted bookmark in a single list ordered by creation timestamp descending (newest first).
2. The system shall display each bookmark's title and URL in the list.
3. While the bookmark list is empty, the system SHALL render an empty-state message instead of an empty list container.

<!-- loom:story-end id=US-002 -->

### US-003: Open a Bookmark in a New Tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the laptop's single user, I want to open a saved bookmark in a new browser tab, so that I can visit the page without losing my current view of the list.

**Acceptance criteria:**
1. WHEN the user activates a bookmark entry in the list, the system SHALL open the bookmark's URL in a new browser tab.
2. The system shall render each bookmark entry as an anchor element with `target="_blank"` and `rel="noopener noreferrer"`.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a Bookmark
<!-- loom:story id=US-004 status=answered -->

**Story:** As the laptop's single user, I want to delete a bookmark I no longer want, so that my list stays useful and uncluttered.

**Supporting decisions:** Q04 (no edit; delete is the only mutation after create)

**Acceptance criteria:**
1. WHEN the user activates the delete control on a bookmark entry, the system SHALL remove that bookmark's row from SQLite and SHALL remove it from the rendered list.
2. WHEN a bookmark has been deleted, the system SHALL allow the same URL to be saved again as a new bookmark.
3. IF the user attempts to delete a bookmark that no longer exists (e.g. already deleted in a parallel tab), then the system SHALL respond without error and SHALL leave the remaining list intact.

<!-- loom:story-end id=US-004 -->

## Constraints

Universal envelope conditions and harness rules. These hold across every story.

### Workspace isolation (harness)

- Every deliverable file — `package.json`, `package-lock.json`, `tsconfig.json`, all source, all tests, all build output, `node_modules`, the SQLite database file, anything `npm` writes — SHALL be created under `.loom/baseline-1779088265-1/app/` relative to the seed location.
- The app SHALL NOT write any file outside that workspace directory.
- `npm start` and `npm test` SHALL be runnable from inside `./app/`.
- The runtime SHALL NOT write to the repo root, to `orchestrator/`, or to any sibling `.loom/<other-project>/` workspace.

### Stack (pinned by seed, not re-opened in Spec)

- TypeScript SHALL be used for all source files, backend and frontend.
- The backend SHALL be a single Node + Express process.
- Storage SHALL be SQLite accessed via `better-sqlite3`, with the database file on disk next to the server.
- The frontend SHALL be plain HTML + CSS + vanilla TypeScript compiled into a single JS bundle via `esbuild`. No React, no Vue, no other framework.
- Tests SHALL use Vitest.
- `npm start` SHALL boot the server on `http://localhost:3000` and serve the UI from the same origin.
- `npm test` SHALL run the Vitest suite.

### Runtime invariants

- The app SHALL run entirely on the user's machine: no outbound network calls, no telemetry, no analytics, no remote error reporting, no service worker, no PWA manifest.
- There SHALL be no authentication, authorization, or user-account surface; the app trusts the single local user.
- The persisted SQLite file SHALL survive process restarts: bookmarks written before a stop SHALL appear after the next `npm start`.
- All anchor elements that open bookmark URLs SHALL include `rel="noopener noreferrer"` so opened pages cannot access the app's `window`.

### Data model invariants

- Each bookmark SHALL have, at minimum: a URL, a title, and a creation timestamp.
- The URL column SHALL have a UNIQUE constraint so duplicate-URL inserts fail at the storage layer, not only at the application layer.
- Bookmarks SHALL be append-only and delete-only at the API level: no update path is exposed.

## Open ambiguity

None. The five questions the seed explicitly asked Spec to put to the user (Q01–Q05) are answered; the stack, workspace, and anti-scope envelope are fixed by the seed itself. Remaining decisions (concrete SQLite schema beyond the invariants above, exact API route shapes, file layout inside `app/`, CSS approach) are Design-phase choices, not Spec ambiguity.
