---
project: baseline-1779088275-1
phase: spec
---

# Decisions — baseline-1779088275-1

Grilling artifact. Categories: `Y/N`, `Choice`, `Architecture`, `Background`, `Open`. Foundation pass added no questions — the seed itself fully establishes the problem space (single user, local laptop, no existing system, stack and runtime pinned, success = four user-observable features working). Branching pass resolved the five open product decisions the seed itself enumerated.

---

## Q01 [Choice]: Tags / categories vs. flat list?

<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed enumerates "tags or categories, or just a flat list?" as an explicit
open decision. Adding tags or categories changes the data model, the UI, and
the test surface; staying flat keeps the four-feature surface minimal as the
seed asks for.

Current behavior / what's causing it:
There is no existing app. The seed states "Keep the surface small" and lists
exactly four behaviours (save, list, open, delete). Tagging would add a tag
schema, tag CRUD or an inline tag editor, and tag-filtered listing — none of
which are in the four-behaviour list.

Options:
  (A) [S, Low]  Flat list — one bookmarks table, no tags, no categories, smallest surface
  (B) [M, Med]  Tags (many-to-many) — extra table, tag chips in UI, filter-by-tag listing
  (C) [M, Med]  Single category per bookmark — one nullable category column, dropdown in UI

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Flat list | S | Low | One bookmarks table, no tags, no categories, smallest surface |
| (B) Tags (many-to-many) | M | Med | Extra table, tag chips in UI, filter-by-tag listing |
| (C) Single category per bookmark | M | Med | Nullable category column, dropdown in UI |

**Recommendation:** (A) — keeps the four-feature surface intact and matches the seed's "keep it small" directive
**Why not the others:** (B) and (C) both expand the data model and UI for a feature the seed did not request

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should the app handle a save attempt with a URL that already exists?

<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
The seed asks whether a duplicate URL on save should be rejected, merged, or
allowed. The choice determines both the data layer (unique constraint or
not) and the UX (inline error, silent dedupe, or two rows with the same
URL).

Current behavior / what's causing it:
With a flat list (Q01) the dedupe surface is just one column. Rejecting is
the simplest contract: a UNIQUE constraint on `url`, plus a clear inline
error message in the UI. Merging requires a deterministic merge rule
(whose title wins? when?); allowing duplicates leaves the user to clean up
manually.

Options:
  (A) [S, Low]  Reject duplicates with inline error — UNIQUE(url) in SQLite, 409 + inline message
  (B) [M, Med]  Merge silently — keep the existing row, optionally overwrite the title with the new one
  (C) [S, Low]  Allow duplicates — no constraint; two rows with the same URL are fine

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Reject duplicates with inline error | S | Low | UNIQUE(url) in SQLite, 409 + inline message |
| (B) Merge silently | M | Med | Keep existing row, optionally overwrite title; needs a deterministic rule |
| (C) Allow duplicates | S | Low | No constraint; two rows with the same URL coexist |

**Recommendation:** (A) — explicit failure mode, no hidden mutation, smallest UX surprise
**Why not the others:** (B) needs a merge-rule decision the seed didn't ask for; (C) makes the user clean up manually

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Add a search box?

<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
The seed asks whether a search box is needed, or whether a chronological
list is enough "at this size". Search adds an input element, server-side
filtering, and a small test matrix; omitting it keeps the page to a list
plus an add form.

Current behavior / what's causing it:
With a flat list (Q01) and "single user, runs on my laptop" scale, the
expected dataset is small — easily scannable in a single chronological
list. Adding search before there is friction risks the kind of nice-to-have
the seed explicitly warned against.

Options:
  (YES) [S, Low]  Add a search box — a text input that filters the visible list by title and URL substring
  (NO)  [S, Low]  No search — chronological list only, browser Ctrl-F is the fallback

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (NO) No search | S | Low | Chronological list only; browser Ctrl-F is the fallback |
| (YES) Add a search box | S | Low | Text input filters list by title/URL substring |

**Recommendation:** NO — matches "keep the surface small" and Ctrl-F covers the same need at this scale
**Why not the other:** YES is cheap but adds a feature the seed flagged as optional, not requested

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Allow editing a saved bookmark's title or URL after creation?

<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether bookmarks are editable post-creation or immutable.
Editing adds an inline editor (or modal), a PATCH endpoint, and the
duplicate-URL collision rule from Q02 has to apply on edit too. Immutable
keeps the surface to add + list + open + delete.

Current behavior / what's causing it:
The four behaviours the seed names are save, list, open, and delete. The
"correction" workflow for a typo is delete-and-recreate — one extra click,
no extra code. Immutable also keeps the data model append-only-ish, which
is friendlier to a tiny SQLite file.

Options:
  (YES) [M, Med]  Editable — PATCH /api/bookmarks/:id, inline edit UI, duplicate check applies on edit
  (NO)  [S, Low]  Immutable — bookmarks are append-only; user deletes and re-creates to correct a typo

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (NO) Immutable | S | Low | Append-only; user deletes + recreates to correct typos |
| (YES) Editable | M | Med | PATCH endpoint, inline edit UI, dedupe re-runs on edit |

**Recommendation:** NO — matches the four-behaviour surface; delete-and-recreate is a one-click correction path
**Why not the other:** YES adds an endpoint, a UI affordance, and a re-application of the dedupe rule for a workflow the seed didn't request

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Choice]: Offer sort orders other than newest-first?

<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether sort orders other than newest-first are needed.
Adding sort options means a dropdown, a server-side ORDER BY parameter (or
client-side sort), and a test matrix per sort key.

Current behavior / what's causing it:
At single-user / single-laptop scale, the user's recall pattern is "the
thing I added most recently" plus scanning. Other orders (alpha by title,
oldest-first, by URL host) are speculative and don't follow from any
behaviour in the seed.

Options:
  (A) [S, Low]  Newest-first only — single ORDER BY created_at DESC, no UI control
  (B) [M, Med]  Newest + alphabetical — dropdown with two options, two ORDER BY paths
  (C) [M, Med]  Newest + alpha + oldest-first — dropdown with three options

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Newest-first only | S | Low | Single ORDER BY created_at DESC, no UI control |
| (B) Newest + alphabetical | M | Med | Dropdown with two options |
| (C) Newest + alpha + oldest-first | M | Med | Dropdown with three options |

**Recommendation:** (A) — matches the seed's "no nice-to-haves I did not ask for" stance
**Why not the others:** (B) and (C) add a UI control and a test matrix without a stated user need

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

_None._

## Deferred clarifications

_None._

## Notes

- Foundation grilling produced no questions: the seed fully establishes the problem space (single user, local laptop, no existing system, stack and runtime fully pinned, success criterion = the four user-observable behaviours working via `npm start` / `npm test`).
- Branching grilling resolved exactly the five decisions the seed enumerated. The consistency pass (grilling.md §5) found no flips: every answer reinforces the minimal-surface direction already implied by the seed.
- Implementation-default decisions (URL validation strictness, title trimming, max field lengths, exact error-message wording) are captured as Constraints in `spec.md`, not as branching questions — per G1 they don't change the next step in a way that would surface in user-facing behaviour.
