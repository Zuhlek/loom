---
project: baseline-1779046840-1
created: 2026-05-17T19:42:00Z
---

# Spec — baseline-1779046840-1

## What we're building

A tiny local-only "Bookmarks" web app that runs on a single laptop. It
lets one user save URLs with titles, see them in a chronological list,
open them in a new tab, and delete the ones they no longer want. No
auth, no deploy, no multi-user surface — the entire app boots from
`npm start` and serves both the API and the UI at `http://localhost:3000`.

The app is intentionally four features wide and no wider. Bookmarks are
immutable once added; duplicate URLs are rejected with an inline error;
there is no search, no tagging, no edit, and no sort other than
newest-first.

## Users and value

**Primary (and only) user:** the developer running the app on their own
laptop, single-user, no shared instance.

**Value:** a frictionless personal-URL bin that survives restarts.
Compared to a browser's built-in bookmarks UI, this is hackable, lives
in one file (`bookmarks.db`), and is small enough to read end-to-end.
The user can extend it later, but the four shipped features are useful
on day one without any login, sync, or setup beyond `npm start`.

## Scope

- Save a bookmark — submit a URL plus a title; persist to SQLite.
- List bookmarks — render every saved bookmark, newest-first, in one
  page.
- Open a bookmark — click the title or URL, opens the target in a new
  browser tab.
- Delete a bookmark — remove it from the list and from SQLite.
- Reject duplicate URLs with an inline error message.
- Persist everything to a SQLite file on disk via `better-sqlite3`,
  next to the server entry, so the list survives process restarts.
- Serve the compiled vanilla-TS frontend bundle from the same Express
  origin that exposes the API.
- One-command start (`npm start`) and one-command test (`npm test`),
  both runnable from inside `./app/`.

## Out of scope

- Authentication, user accounts, multi-user, sharing.
- Deployment, hosting, Docker, CI configuration.
- Tags, categories, folders, or any other taxonomy.
- Search box or any filter UI over the list.
- Editing a bookmark after creation (delete + re-add is the substitute).
- Sort orders other than newest-first (no oldest-first toggle, no
  alphabetical sort, no by-domain grouping).
- Frontend frameworks (no React, Vue, Svelte, etc. — vanilla TS only).
- Telemetry, analytics, service worker, PWA manifest, dark-mode toggle
  (unless it falls out of CSS for free — not a deliverable).
- Pagination, infinite scroll, or virtualization of the list.
- Bookmark thumbnails, favicon fetching, link previews, archiving.

## User stories

### US-001: Save a bookmark with title and URL
<!-- loom:story id=US-001 status=answered -->

**Story:** As the laptop user, I want to save a URL together with a
title, so that I can find and re-open useful pages later.

**Supporting decisions:** Q01 (flat list, no taxonomy), Q02 (duplicates
rejected)

**Acceptance criteria:**
1. WHEN the user submits the save form with a non-empty title and a valid URL, the system SHALL persist a new bookmark row to SQLite and return success.
2. WHEN the save succeeds, the system SHALL show the new bookmark at the top of the list without requiring a manual page reload.
3. IF the submitted URL exactly matches an already-saved URL, then the system SHALL reject the submission and SHALL display an inline error indicating the duplicate.
4. IF the title is empty or the URL fails basic URL validation, then the system SHALL reject the submission and SHALL display an inline validation error.

<!-- loom:story-end id=US-001 -->

### US-002: See all bookmarks newest-first
<!-- loom:story id=US-002 status=answered -->

**Story:** As the laptop user, I want every saved bookmark visible in
one chronological list, so that I can scan my recent saves without
querying or filtering.

**Supporting decisions:** Q03 (no search), Q05 (newest-first only)

**Acceptance criteria:**
1. WHEN the user loads the page, the system SHALL render every saved bookmark, ordered most-recently-saved first.
2. The system SHALL display each bookmark's title and URL together with a delete control.
3. While the bookmark list is empty, the system SHALL display an "empty state" message instead of an empty list.

<!-- loom:story-end id=US-002 -->

### US-003: Open a saved bookmark in a new tab
<!-- loom:story id=US-003 status=answered -->

**Story:** As the laptop user, I want a one-click way to open any saved
bookmark in a new browser tab, so that I don't lose my place in the
bookmarks list.

**Acceptance criteria:**
1. WHEN the user activates a bookmark's link control, the system SHALL open that bookmark's URL in a new browser tab.
2. The system SHALL leave the bookmarks page itself open and unchanged when a bookmark is opened.

<!-- loom:story-end id=US-003 -->

### US-004: Delete a bookmark I no longer want
<!-- loom:story id=US-004 status=answered -->

**Story:** As the laptop user, I want to remove a saved bookmark, so
that my list reflects only the URLs I still care about.

**Supporting decisions:** Q04 (immutable — delete-and-re-add replaces edit)

**Acceptance criteria:**
1. WHEN the user activates a bookmark's delete control, the system SHALL remove that bookmark from SQLite.
2. WHEN the delete succeeds, the system SHALL remove that bookmark from the rendered list without requiring a manual page reload.
3. IF the targeted bookmark no longer exists at delete time, then the system SHALL surface a non-fatal message and SHALL leave the rest of the list intact.

<!-- loom:story-end id=US-004 -->

## Constraints

1. **Workspace isolation (harness constraint, non-negotiable).** Every
   deliverable file for this run — `package.json`, `tsconfig.json`,
   source code, tests, build output, `node_modules`, the SQLite file,
   anything `npm` writes — MUST live inside
   `.loom/baseline-1779046840-1/app/`. No files MAY be created at the
   repo root, under `orchestrator/`, under `ui/`, under `docs/`, or in
   any sibling `.loom/<other>/` workspace.
2. **`npm start` and `npm test` are runnable from `./app/`.** Both
   commands MUST work with `cd .loom/baseline-1779046840-1/app/ && npm
   start` (or `npm test`) after a fresh `npm install`.
3. **`npm start` boots the server on `http://localhost:3000` and serves
   the UI from the same origin** as the API. No separate static-file
   host, no CORS surface.
4. **Stack is fixed by the seed, no substitutions.** TypeScript
   everywhere; Node + Express single-process backend; SQLite via
   `better-sqlite3` with the database file on disk next to the server
   entry; plain HTML + CSS + vanilla TypeScript frontend bundled to one
   JS file via `esbuild`; Vitest for tests. No React, Vue, Svelte, or
   any other framework.
5. **Single-user, local-only.** No authentication surface, no network
   listening beyond localhost, no telemetry, no analytics, no external
   API calls at runtime.
6. **URL uniqueness is enforced at the storage layer.** The SQLite
   schema MUST enforce uniqueness on the URL column so a duplicate
   insert fails atomically, not only via an application-level check.
7. **No background work, service workers, or PWA surface.** The app is
   a request/response Express server plus a single bundled JS page.

## Open ambiguity

None. The seed pins the stack and the harness pins the workspace;
Q01–Q05 resolved every "things I have not decided yet" item the seed
listed. Remaining choices (exact route shape, column names, CSS
treatment, esbuild config layout, whether `npm start` performs the
bundle build as a pre-step or assumes a prior `npm run build`) are
Design-phase concerns, not Spec ambiguity.
