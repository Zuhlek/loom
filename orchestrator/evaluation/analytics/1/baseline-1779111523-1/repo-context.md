# Repo Context — baseline-1779111523-1

Seed-relevant slice for the Bookmarks fabric. Cross-references
`.loom/.cache/repo-digest.md` for stable host-repo facts; this file
captures only what is specific to this seed.

## Seed in one line

Local-only, single-user, four-feature Bookmarks web app built from
scratch in TypeScript on Node + Express + SQLite (`better-sqlite3`) with
a vanilla-TS frontend bundled by `esbuild`, tested with Vitest. One
`npm start`, one `npm test`.

## Fabric isolation and workspace

- This is a **greenfield** fabric. Per `repo-digest.md` §"Conventions",
  greenfield fabrics do not extend or import from the loom orchestrator
  itself; they are independent codebases tracked under `.loom/`.
- **Hard harness constraint** (HARNESS-DIRECTIVE block in `seed.md`):
  every deliverable file (`package.json`, `tsconfig.json`, sources,
  tests, build output, `node_modules`, the SQLite file, anything `npm`
  writes) MUST be created inside `./app/` **relative to this seed file**
  — i.e. inside `.loom/baseline-1779111523-1/app/`. Never write to the
  repo root, to `orchestrator/`, or to any sibling workspace.
- `npm start` and `npm test` MUST be runnable from `./app/`.
- Multiple baseline runs execute in adjacent workspaces and would
  overwrite each other if this is violated.

## Stack — fixed by the seed, no substitutions

| Concern | Choice |
| --- | --- |
| Language | TypeScript everywhere |
| Backend | Node + Express, single process |
| Storage | SQLite via `better-sqlite3`, file on disk next to the server |
| Frontend | Plain HTML + CSS + vanilla TypeScript, one JS bundle via `esbuild`. No React / Vue / framework. |
| Tests | Vitest |
| Entrypoints | `npm start` → boots server on `http://localhost:3000`, serves UI from same origin. `npm test` → runs Vitest. |

These are seed-mandated; Spec does NOT re-question them.

## Four user-observable features (seed-locked)

1. Save a URL with a title.
2. See all saved bookmarks in one list.
3. Open a saved bookmark in a new tab.
4. Delete a bookmark.

The seed is emphatic about scope discipline: "Keep the surface small …
No nice-to-haves I did not ask for. No telemetry, no analytics, no
service worker, no PWA manifest, no dark mode toggle unless it falls
out of CSS for free."

## Open decisions the seed explicitly defers to grilling

The seed lists five things the user wants asked, not silently chosen.
These map directly to the queued answers in `.answers.yaml`:

| Seed bullet | Q-ID | Queued answer (snapshot — authoritative copy lives in `.answers.yaml`) |
| --- | --- | --- |
| Tags / categories vs flat list | Q01 | Flat list (no tags / no categories) |
| Duplicate URL handling (reject / merge / allow) | Q02 | Reject duplicate URLs with an inline error |
| Search box vs chronological list only | Q03 | Chronological list only (no search) |
| Editable after creation vs immutable | Q04 | Immutable once added (no edit) |
| Sort order other than newest-first | Q05 | Newest-first only |

Spec phase MUST surface each as a real grilling question (briefing +
options + recommendation) and let the answer queue drive the picks.

## Files likely to be touched in Build phase (inside `./app/`)

Not prescriptive — Design phase decides final layout. As prior art:

- `app/package.json`, `app/tsconfig.json`
- `app/src/server/` (Express bootstrap, routes, DB helpers)
- `app/src/client/` (vanilla TS UI source)
- `app/public/` (static HTML + CSS + bundled JS output)
- `app/data/bookmarks.sqlite` (or sibling file next to server entry, per
  seed wording — final path is a Design decision)
- `app/tests/` (Vitest specs)

## Integration points / external services

None. The seed says explicitly: local-only, single user, runs on the
user's laptop, no auth, no deploy, no telemetry, no analytics, no
service worker, no PWA manifest. The system makes no outbound network
calls at runtime.

## Out-of-repo facts grilling may still need

- The user's tolerance for URL validation strictness (RFC vs. liberal).
- Whether "delete" should confirm or be one-click (small UX detail).
- The exact shape of the inline duplicate-rejection message.

These are minor and can be handled as Constraints / Open ambiguity if
the queue exhausts before they surface as questions.

## Out of scope for this fabric (seed-explicit)

- Authentication / multi-user.
- Deployment / hosting / containers.
- Telemetry, analytics, error reporting.
- Service worker, PWA manifest, offline behaviour beyond the inherent
  local-only nature.
- Dark mode toggle (unless free from CSS).
- Any feature beyond the four enumerated.
