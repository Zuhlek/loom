---
project: baseline-1779002783-2
phase: spec
---

# Decisions — baseline-1779002783-2

Grilling decisions for the local-only Bookmarks web app. Foundation was
skipped: the seed enumerates its own undecideds and the repo-context
slice (`repo-context.md`) plus the cached digest cover the rest. No team
context, regulatory, or integration-point unknowns remain. Branching
proceeds directly into the five seed-named decisions.

## Q01 [Choice]: Should bookmarks have tags / categories, or stay a flat list?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** seed

What's the issue:
The seed asks whether bookmarks should carry tags or categorisation, or
remain a single ungrouped list. This decision shapes the data model, the
UI surface (filter chips vs none), and the API. Adding it later is a
schema migration plus a filter UI.

Current behavior / what's causing it:
The seed names four core features (save, list, open, delete) and warns
against scope creep. A single user, local-only app at "a few dozen to
maybe a few hundred bookmarks" scale gets little organisational value
from tags relative to the UI cost. The seed's last paragraph says
"rather you ship a clean four-feature app than a sprawling one."

Options:
  (A) [S, Low]  Flat list (no tags / no categories) — minimal schema, matches seed's "small surface" preference
  (B) [M, Med]  Free-form tags (many-to-many) — flexible filter UI, schema migration if added later
  (C) [M, Med]  Single category per bookmark — middle ground, picker UI on save

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Flat list (no tags / no categories) | S | Low | Minimal schema, matches seed's "small surface" preference |
| (B) Free-form tags | M | Med | Flexible filter UI, schema migration if added later |
| (C) Single category per bookmark | M | Med | Middle ground, picker UI on save |

**Recommendation:** (A) — seed explicitly preferences a small, clean four-feature surface
**Why not the others:** (B)/(C) add a filter UI and migration cost for organisational value the user has not asked for
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should saving an already-saved URL be handled?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** seed

What's the issue:
The seed asks what happens if a URL is saved a second time: reject the
attempt, merge into the existing row, or allow duplicates. This drives
the schema (UNIQUE constraint), the POST `/bookmarks` response shape,
and the UI error path.

Current behavior / what's causing it:
For a single-user local bookmarks store, duplicates are almost always
mistakes. Allowing them clutters the list; merging silently is
surprising and hides the duplicate-add. Rejecting with a clear inline
error is the least-surprising behaviour and the cheapest to implement
on top of a UNIQUE(url) index.

Options:
  (A) [S, Low]  Reject duplicate URLs with an inline error — UNIQUE(url) index, 409 response, UI surfaces the error
  (B) [M, Med]  Merge into existing (update title, refresh timestamp) — silent behaviour, schema needs updated_at
  (C) [S, Med]  Allow duplicates freely — simplest schema, noisier list over time

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Reject with inline error | S | Low | UNIQUE(url) index, 409 response, UI surfaces the error |
| (B) Merge into existing | M | Med | Silent behaviour, schema needs updated_at |
| (C) Allow duplicates | S | Med | Simplest schema, noisier list over time |

**Recommendation:** (A) — least surprising for a single-user store and cheap to implement on UNIQUE(url)
**Why not the others:** (B) is silent and surprising; (C) lets the list rot
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Include a search box in the UI?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** seed

What's the issue:
The seed asks whether a search box is needed, or whether a chronological
list is enough at this scale. Search adds a text input, a debounce, a
SQL `LIKE` (or FTS) query, and tests. Without it, the user scrolls.

Current behavior / what's causing it:
The expected dataset is small (single user, local laptop, maybe a few
hundred bookmarks at most). A chronological list with newest-first
ordering and a browser Find (Cmd-F) on the rendered titles handles the
search use case for free. The seed's last paragraph excludes nice-to-haves
the user didn't ask for.

Options:
  (YES) [S, Low]  Add a search box (title + URL substring match) — extra UI, debounce, LIKE query, tests
  (NO)  [S, Low]  Chronological list only (no search) — relies on scroll + browser Find, matches seed's small-surface preference

**Recommendation:** NO — dataset is small, browser Find covers the use case, seed prefers minimal surface
**Why not the other:** YES is fine if the dataset grows past a few hundred entries; revisit then
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Can a saved bookmark's title / URL be edited after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** Q02

What's the issue:
The seed asks whether the title and URL are editable after a bookmark
is saved, or fixed at creation time. Editing adds a PATCH route, an
edit UI mode, validation on update, and tests. Immutable means a
delete-and-recreate workflow for typos.

Current behavior / what's causing it:
Q02 already settles that duplicate URLs are rejected. With immutability,
the only correction path is delete-then-re-add, which is acceptable for
single-user local-only at this scale. Edits multiply the surface area:
PATCH endpoint, conflict handling against the UNIQUE(url) index, edit
form, optimistic update vs reload. Seed pushes hard against scope creep.

Options:
  (YES) [M, Med]  Allow edit after creation (PATCH /bookmarks/:id) — extra route, form, tests, UNIQUE collisions
  (NO)  [S, Low]  Immutable once added (no edit) — correction is delete+re-add, matches seed's four-feature scope

**Recommendation:** NO — seed names exactly four operations (save, list, open, delete); edit is not among them
**Why not the other:** YES is reasonable if typo fixes become friction; revisit when that's observed
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Y/N]: Offer any sort order other than newest-first?
<!-- loom:question version=1 id=Q05 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** seed

What's the issue:
The seed asks whether sort options beyond newest-first are required.
Multiple sort orders mean a sort control in the UI, an ORDER BY
parameter on the list endpoint, and tests per ordering.

Current behavior / what's causing it:
For a small single-user dataset, recency is the dominant access pattern
("what did I just save", "what was I looking at"). Title or URL sort
adds a control surface that earns little at this scale. Seed prefers
minimal surface.

Options:
  (YES) [M, Low]  Add alternate sort orders (e.g. title A→Z) — sort control, ORDER BY param, per-order tests
  (NO)  [S, Low]  Newest-first only — single ORDER BY created_at DESC, no UI control, matches seed's small-surface preference

**Recommendation:** NO — recency dominates for personal bookmarks; revisit if the list grows past comfortable scroll
**Why not the other:** YES is plausible if alphabetical browsing becomes the dominant use; not the case today
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none)*

## Deferred clarifications

*(none — all five seed-listed undecideds are answered)*
