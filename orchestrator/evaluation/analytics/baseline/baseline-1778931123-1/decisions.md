---
project: baseline-1778931123-1
created: 2026-05-16
---

# Decisions — Bookmarks

Spec-phase grilling record. Foundation sub-phase was satisfied directly by the
seed (greenfield, stack locked, single-user, local-only, workspace pinned to
`./app/`) and `repo-context.md`. Branching sub-phase resolved the five
ambiguities the seed explicitly flagged.

## Q01 [Y/N]: Should bookmarks support tags or categories?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Status:** answered

What's the issue:
The seed lists four features (save, list, open, delete) and asks whether
bookmarks should also carry tags or categories, or remain a flat list. This
decision changes the data model, the UI shape, and the surface area of every
later screen.

Current behavior / what's causing it:
There is no existing app — this is greenfield. With a single user on one
laptop and a small expected corpus, a flat list keeps the schema to one table
and the UI to one rendered list. Tags would add a many-to-many table, a tag
editor, and a filter control.

Options:
  (A) [S, Low]  Flat list — single `bookmarks` table; render in one chronological list
  (B) [M, Med]  Tags as freeform labels — many-to-many table, tag chip UI, filter control
  (C) [L, High] Hierarchical categories — folder tree, drag-to-move, breadcrumb UI

Recommendation: (A) — keeps the surface to four features as the seed insists
Why not the others: (B)/(C) add schema and UI weight the seed asks to avoid

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should we handle saving a URL that already exists?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Status:** answered

What's the issue:
The seed asks how the system should react if the user submits a URL that is
already in the bookmarks table. Three behaviours are common (reject, merge,
allow duplicates) and each has a different UX and a different invariant on
the data.

Current behavior / what's causing it:
With no constraint, the table would happily store the same URL twice — likely
a foot-gun for a single user who paste-clicks the save button. A UNIQUE index
on the URL column is the cheapest enforcement; the question is what to do at
the UI when the constraint trips.

Options:
  (A) [S, Low]  Reject duplicate URLs with an inline error — UNIQUE index + UI message
  (B) [M, Med]  Merge duplicates — overwrite title on collision, keep one row
  (C) [S, High] Allow duplicates — no constraint, list shows repeats

Recommendation: (A) — preserves data integrity and surfaces the collision plainly
Why not the others: (B) silently mutates an existing row; (C) clutters the list

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Should the UI include a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Status:** answered

What's the issue:
The seed asks whether a search box is needed, or whether a chronological list
is enough at this size. Search adds an input, a filter pipeline over the
client-side list (or a `LIKE` query on the server), and one more thing to
test.

Current behavior / what's causing it:
For a single-user laptop bookmarker the working corpus is plausibly tens to
low hundreds of rows. Browsers' Ctrl-F already finds substrings in a
rendered list of that size, so a custom search box adds surface without
much benefit until the list grows beyond a screen or two.

Options:
  (YES) [M, Low]  Add a search box — client-side substring filter over title and URL
  (NO)  [S, Low]  Chronological list only — rely on Ctrl-F or visual scan

Recommendation: NO — chronological list is enough at this scale per the seed
Why not the other: YES is cheap but pulls the surface past the four core features

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Should bookmarks be editable after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Status:** answered

What's the issue:
The seed asks whether a saved bookmark's title and URL can be changed, or
whether bookmarks are immutable once added. Editability adds an edit form,
a PATCH route, and validation on URL changes that may trip the uniqueness
constraint from Q02.

Current behavior / what's causing it:
The four named features are save, list, open, delete. Edit is not in that
list. With delete already available, a user who mis-typed a title can delete
and re-add — at the cost of losing the original creation time, which is
probably not material for a single-user bookmarker.

Options:
  (YES) [M, Med]  Editable — PATCH route, edit form, re-validate URL uniqueness
  (NO)  [S, Low]  Immutable — only save/list/open/delete; re-add to fix mistakes

Recommendation: NO — matches the four-feature surface the seed asks to keep
Why not the other: YES is friendlier but adds a fifth feature the seed excludes

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Y/N]: Are sort orders other than newest-first needed?
<!-- loom:question version=1 id=Q05 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Status:** answered

What's the issue:
The seed asks whether any sort order other than newest-first is needed.
Additional sort orders (oldest-first, alphabetical) require a sort control
in the UI, optional indexes, and a default-vs-user-pick decision.

Current behavior / what's causing it:
For a small bookmarks corpus, newest-first matches "what did I just save"
and "what's the most recent thing I want to revisit." Alphabetical and
oldest-first are common in larger lists but add UI controls and a user
preference to persist.

Options:
  (YES) [M, Low]  Multiple sort orders — UI control + persisted preference
  (NO)  [S, Low]  Newest-first only — single `ORDER BY created_at DESC` query

Recommendation: NO — single ordering keeps the UI to one rendered list
Why not the other: YES is mild surface growth but the seed asks to minimize

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none captured during this run)*

## Deferred clarifications

*(none — all five seed-flagged ambiguities resolved)*
