---
project: baseline-1779046840-1
created: 2026-05-17T19:42:00Z
---

# Decisions — baseline-1779046840-1

Branching questions distilled from the seed's explicit "Things I have not
decided yet" list. Foundation surfaced no open questions: the seed pins
the stack, the harness pins the workspace, and `repo-context.md` covers
prior art. Branching answers were captured via the non-interactive
`.answers.yaml` queue per `methods/grilling.md` §4.

---

## Q01 [Y/N]: Should bookmarks have tags or categories, or just a flat list?
<!-- loom:question version=1 id=Q01 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed leaves taxonomy open. A flat list is the smallest possible
surface — one table, one view, no taxonomy UI. Tags add a join table,
filter UI, tag-management affordances, and at least one extra screen
state per tag operation.

Current behavior / what's causing it:
No code exists; this is greenfield. The seed says "keep the surface
small" and "I would rather you ship a clean four-feature app than a
sprawling one", which biases against any taxonomy layer the user has
not explicitly asked for.

Options:
  (YES) [M, Med] Add tags or categories — taxonomy UI, join table, filter affordances
  (NO)  [S, Low] Flat list only — one table, one list view, no taxonomy code paths

Recommendation: NO — matches the seed's explicit "keep the surface small" mandate
Why not the other: tags add UI, schema, and filter logic the user has not asked for
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should duplicate URL submissions be handled?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed explicitly asks whether re-saving an existing URL should reject,
merge, or allow duplicates. The choice shapes the server's POST contract,
the schema's uniqueness constraints, and the frontend's error surface.

Current behavior / what's causing it:
No code exists. SQLite supports a `UNIQUE` constraint on the URL column
trivially via `better-sqlite3`; rejection on conflict is one branch in
the insert handler. Merge implies an "update title on conflict" path;
allow-duplicates means no constraint and a list that may repeat entries.

Options:
  (A) [S, Low]  Reject duplicate URLs with an inline error — UNIQUE constraint + 409-style response surfaced as inline UI error
  (B) [M, Med]  Merge — keep the existing row, update the title silently if it differs
  (C) [S, Low]  Allow duplicates — no constraint, list may show the same URL many times

Recommendation: (A) — keeps the list deduplicated without silently overwriting prior titles
Why not the others: (B) hides user intent on conflict; (C) clutters the chronological list
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Should the UI include a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether a search box is needed or whether a chronological
list is enough at this size. Search implies a query input, debounce
handling, server-side or client-side filtering, and at least one new
state in the UI.

Current behavior / what's causing it:
This is a single-user local app on one laptop with no stated size
target. With the seed's "keep the surface small" mandate and no expected
volume justifying server-side search, a chronological list scrolls fine
for hundreds of rows.

Options:
  (YES) [M, Low] Add a search box — text input + client-side filter over the rendered list
  (NO)  [S, Low] Chronological list only — no filter UI, the list is the entire surface

Recommendation: NO — matches the seed's "keep the surface small" mandate at this size
Why not the other: search adds UI and filter logic the user has not asked for at this scale
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Should bookmarks be editable after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether title and URL can be edited post-creation or
whether bookmarks are immutable. Edit implies a PATCH/PUT endpoint, an
edit form (inline or modal), validation on update, and the duplicate
check from Q02 has to re-run on URL change.

Current behavior / what's causing it:
The seed's four explicit features are save / list / open / delete. Edit
is a fifth feature the seed does not list among the core four; the
delete-and-re-add path covers the same intent without a new endpoint.

Options:
  (YES) [M, Med] Editable — PUT endpoint, edit UI, re-run duplicate check on URL change
  (NO)  [S, Low] Immutable — delete then re-add to "edit"; no PUT, no edit form

Recommendation: NO — matches the seed's listed four features; delete+re-add covers the intent
Why not the other: editable adds an endpoint, UI state, and duplicate-recheck logic
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Choice]: What sort order(s) should the list support?
<!-- loom:question version=1 id=Q05 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** —

What's the issue:
The seed asks whether any sort order other than newest-first is needed.
Multiple sort orders mean a sort control, a sort-state variable, and
either re-queries or client-side resort on each toggle.

Current behavior / what's causing it:
The default mental model for a save-and-browse app is reverse-chronological
— the user expects what they just saved at the top. Alternative orders
(alphabetical, oldest-first, by domain) are useful at larger volume.

Options:
  (A) [S, Low] Newest-first only — single ORDER BY in the query, no UI control
  (B) [M, Med] Newest-first + oldest-first toggle — one button, two server queries (or one client-side reverse)
  (C) [L, Med] Multiple orders (newest, oldest, title A→Z, title Z→A) — sort dropdown + multiple query paths

Recommendation: (A) — matches the seed's "keep the surface small" mandate at this scale
Why not the others: (B) and (C) add UI controls and query paths the user has not asked for
Status: answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

None.

## Deferred clarifications

None.
