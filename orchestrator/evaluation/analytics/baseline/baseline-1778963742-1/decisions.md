---
project: baseline-1778963742-1
created: 2026-05-16
---

# Decisions — baseline-1778963742-1

Spec-phase grilling record. Five branching questions correspond to the five
explicit asks in the seed (tags/flat, duplicates, search, editability, sort).
Foundation grilling is skipped — the seed is self-contained and `repo-context.md`
captures the relevant context.

All questions are answered non-interactively via `.answers.yaml`
(per ADR-001 / `methods/grilling.md` §4).

---

## Q01 [Choice]: Should bookmarks have tags / categories, or be a flat list?
<!-- loom:question version=1 id=Q01 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

**Briefing**

What's the issue:
The seed asks whether the app needs organisational structure (tags or
categories) on top of bookmarks, or whether a single flat list suffices for the
intended single-user, single-laptop scope. The answer drives whether the data
model has a join table, whether the UI has filter chips, and whether the API
exposes tag CRUD.

Current behavior / what's causing it:
There is no app yet. The seed explicitly bounds scope: "keep the surface
small", "I would rather you ship a clean four-feature app than a sprawling
one", "no nice-to-haves I did not ask for". The four named features are save,
list, open, delete — none of them implies tagging.

Options:
  (A) [S, Low] Flat list (no tags / no categories) — single bookmarks table; simplest schema, smallest UI surface
  (B) [M, Med] Tags (many-to-many) — bookmarks + tags + bookmarks_tags; filter chips in UI, tag CRUD endpoints
  (C) [M, Med] Single category per bookmark — bookmarks gain a category column; dropdown in UI, category management UI needed

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Flat list | S | Low | Single bookmarks table; smallest UI surface |
| (B) Tags (many-to-many) | M | Med | Join table + tag CRUD + filter chips |
| (C) Single category | M | Med | Category column + dropdown + category mgmt |

**Recommendation:** (A) — flat list matches the seed's "keep the surface small" directive and the four-feature scope
**Why not the others:** (B)/(C) add schema, endpoints, and UI surface the seed expressly warns against

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should a duplicate URL save attempt be handled?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

**Briefing**

What's the issue:
The seed asks what happens when the user tries to save a URL that already
exists in their list. Three coherent paths exist: reject the duplicate, merge
(update the existing entry's title), or allow duplicates outright. The choice
determines the uniqueness constraint on the `url` column and the POST endpoint's
error contract.

Current behavior / what's causing it:
There is no app yet. The user is single-user on one laptop; the risk of
"accidentally adding the same URL twice" is real (e.g. saving a tab a second
time months later) and the seed flags it as a real decision rather than a
trivium.

Options:
  (A) [S, Low] Reject duplicate URLs with an inline error — UNIQUE constraint on url; POST returns 409, UI shows inline error
  (B) [M, Med] Merge — keep existing row, update title if changed — UNIQUE constraint; POST silently updates title; user feedback unclear
  (C) [S, Low] Allow duplicates — no constraint; same URL can appear multiple times in the list

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (A) Reject with inline error | S | Low | UNIQUE on url; clean failure mode, explicit user feedback |
| (B) Merge (update title) | M | Med | Silent overwrite; user may not notice title changed |
| (C) Allow duplicates | S | Low | List clutters with repeated URLs; defeats "saved" semantics |

**Recommendation:** (A) — explicit rejection matches the user's mental model ("I already have this") with clearest feedback
**Why not the others:** (B) silently mutates data with no UI for "are you sure?"; (C) lets the list clutter, undermining the four-feature value

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Include a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

**Briefing**

What's the issue:
The seed asks whether the app needs a search box, or whether a chronological
list is enough at this size. The decision drives whether the UI carries a
search input, whether the backend exposes a filter query parameter, and whether
the list view is paginated or fully rendered.

Current behavior / what's causing it:
There is no app yet. The seed scopes this as a single-user laptop tool;
realistic personal bookmark counts are in the low hundreds at most. Native
browser ctrl-F over a fully-rendered list covers the search use case for free.

Options:
  (YES) [M, Low] Add a search box — text input filters the list client-side or via a backend query param
  (NO)  [S, Low] Chronological list only (no search) — full list rendered; user falls back to ctrl-F if needed

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Search box | M | Low | Extra UI + filter logic; useful at large scale |
| (NO) Chronological list | S | Low | Smallest surface; ctrl-F covers the use case |

**Recommendation:** NO — the seed flags "keep the surface small" and ctrl-F covers the at-scale need
**Why not the other:** YES adds UI and a filter contract for a scale the seed does not anticipate

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Allow editing a bookmark's title / URL after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

**Briefing**

What's the issue:
The seed asks whether bookmarks are mutable after creation or immutable once
added. The decision determines whether the API exposes a PATCH/PUT endpoint,
whether the UI has an edit mode, and how the list row behaves on click (open
link vs. enter edit mode).

Current behavior / what's causing it:
There is no app yet. The four named features in the seed are save, list, open,
delete. Edit is conspicuously absent from that list — the user surfaced it as
an explicit open question rather than asserting it.

Options:
  (YES) [M, Med] Editable — PATCH endpoint + in-row edit UI; cursor placement / cancel semantics need design
  (NO)  [S, Low] Immutable once added — to change a bookmark, the user deletes and re-saves

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Editable | M | Med | PATCH endpoint + edit UI + validation rules |
| (NO) Immutable | S | Low | Delete-and-re-add covers the rare correction case |

**Recommendation:** NO — immutability keeps the four named features intact and matches the user's "no nice-to-haves" stance
**Why not the other:** YES adds an endpoint + edit UI + cancel semantics for a use case (typo fix) the seed does not name

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Y/N]: Offer a sort order other than newest-first?
<!-- loom:question version=1 id=Q05 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

**Briefing**

What's the issue:
The seed asks whether the list needs any sort order beyond newest-first. The
decision drives whether the list view carries a sort selector, whether the
backend exposes a sort query parameter, and whether the SQL query is fixed or
parameterised.

Current behavior / what's causing it:
There is no app yet. Newest-first is the obvious default ("most recently
saved" matches the workflow of "I just saved this and want to find it"). The
seed enumerates this as a real open question rather than asserting alternative
sorts.

Options:
  (YES) [M, Low] Add a sort selector — dropdown for created-desc / created-asc / title-asc / title-desc; backend takes a sort param
  (NO)  [S, Low] Newest-first only — ORDER BY created_at DESC; no UI for sort

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| (YES) Sort selector | M | Low | Extra UI + query param; useful at large scale |
| (NO) Newest-first only | S | Low | Single fixed query; smallest UI surface |

**Recommendation:** NO — fixed newest-first matches the seed's small-surface directive and the personal-scale use case
**Why not the other:** YES adds a selector + param for a scale and breadth the seed does not anticipate

Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

*(none captured)*

## Deferred clarifications

*(none captured)*
