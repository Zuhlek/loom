---
project: baseline-1779111523-1
created: 2026-05-18
---

# Decisions — baseline-1779111523-1

Branching decisions for the Bookmarks fabric. Each question has a
`loom:question` marker, a briefing block, an `Options at a glance`
table, a recommendation, and a `loom:answer-slot` capturing the
user's pick (sourced from `.answers.yaml` in this non-interactive run).

Foundation sub-phase produced no branching questions of its own: every
foundational fact (stack, single-user scope, local-only, no auth, no
deploy, four-feature surface, workspace isolation) is declared
verbatim in `seed.md` and digested into `repo-context.md`. Per
`methods/grilling.md` §2, Foundation is "no decisions yet" — we use
it to read context, not to invent questions whose answers are already
written down. Branching therefore opens immediately on the five
decisions the seed explicitly flagged.

---

## Q01 [Y/N]: Should bookmarks have tags or categories?
<!-- loom:question version=1 id=Q01 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** (none)

What's the issue:
The seed explicitly asks whether bookmarks need tagging or
categorisation, or whether a flat unstructured list is enough.
Adding tags now touches the data model (an extra table or column),
the create form (a tag input), the list view (a tag chip / filter),
and tests. Skipping tags keeps the four-feature surface lean.

Current behavior / what's causing it:
Nothing exists yet — greenfield fabric. The seed pushes hard on
minimal surface ("ship a clean four-feature app, not a sprawling
one") and lists only Save / List / Open / Delete as features. A
single user on one laptop saving a small number of bookmarks rarely
hits the "I can't find anything" threshold that motivates tagging
in a multi-user catalogue.

Options:
  (YES) [M, Med]  Add tags or categories — extra table/column, UI affordance, more tests
  (NO)  [S, Low]  Flat list — match the seed's minimal-surface intent and the four-feature scope

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Med | Bookmarks gain a tag / category attribute and corresponding UI filter; surface grows beyond the four declared features. |
| NO  | S | Low | Bookmarks stay a flat chronological list; matches seed's "keep the surface small" directive. |

**Recommendation:** NO — single-user laptop scale rarely needs tagging
**Why not the other:** YES would expand the data model and UI beyond the four-feature scope the seed explicitly asked us to hold.

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q01 -->
Flat list (no tags / no categories)
<!-- loom:answer-slot end id=Q01 -->

---

## Q02 [Choice]: How should we handle saving a URL that already exists?
<!-- loom:question version=1 id=Q02 category=Choice sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** (none)

What's the issue:
The seed asks what should happen when the user tries to save a URL
they have already bookmarked. Three plausible behaviours: reject the
new entry with a message, merge it into the existing one (e.g.
overwrite the title), or just allow duplicates so the list can
contain the same URL twice. Each has a different data-model
contract.

Current behavior / what's causing it:
No save path exists yet. URL uniqueness is a natural primary-key
candidate for a single-user bookmark store — duplicates are usually
a mistake, not a desired state. Merging is surprising (silently
mutates the prior entry). Allowing duplicates pushes a "which one
do I want" decision onto the user later.

Options:
  (A) [S, Low]  Reject with inline error — preserve first-save, predictable, no silent mutation
  (B) [M, Med]  Merge — overwrite the existing title/timestamp; surprising; trickier semantics
  (C) [S, Med]  Allow duplicates — simplest server logic; pushes clutter to the user

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| A | S | Low | DB enforces URL uniqueness; POST returns a 4xx with a message the UI renders inline next to the URL field. |
| B | M | Med | New save silently updates the existing bookmark's title (and possibly timestamp); user may not realise nothing was "added". |
| C | S | Med | Bookmarks table allows duplicate URLs; list view shows the same URL multiple times. |

**Recommendation:** (A) — predictable and matches the seed's minimal surface
**Why not the others:** (B) silently mutates state; (C) lets the list clutter without giving the user a clear signal.

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q02 -->
Reject duplicate URLs with an inline error
<!-- loom:answer-slot end id=Q02 -->

---

## Q03 [Y/N]: Do we need a search box?
<!-- loom:question version=1 id=Q03 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01]

What's the issue:
The seed asks whether the list view needs a search input or whether
a plain chronological list is enough at this scale. A search box
adds a debounced filter UI, a query path (client-side filter or
server endpoint), and tests. Without tags (Q01 = flat list) and at
single-user laptop scale, the natural list size stays small enough
to scroll.

Current behavior / what's causing it:
No list view exists. With a flat newest-first list of a typical
personal bookmark collection (dozens, maybe low hundreds), browser
find (Cmd-F / Ctrl-F) on the rendered HTML is usually adequate.
Adding an in-app search box is more code and is not in the four
declared features.

Options:
  (YES) [M, Med] Add a search box — debounced filter over title/URL
  (NO)  [S, Low] Chronological list only — rely on browser find; match the four-feature scope

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Med | New input wired to a filter (client or server); extra tests; UI surface grows. |
| NO  | S | Low | Single list view, newest-first, no filter; user uses browser find if needed. |

**Recommendation:** NO — chronological list is enough at single-user laptop scale
**Why not the other:** YES adds UI and test surface that the seed explicitly told us not to invent.

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q03 -->
Chronological list only (no search)
<!-- loom:answer-slot end id=Q03 -->

---

## Q04 [Y/N]: Should bookmarks be editable after creation?
<!-- loom:question version=1 id=Q04 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** (none)

What's the issue:
The seed asks whether the user can edit a saved bookmark's title or
URL after creation, or whether bookmarks are immutable once added
(the only mutation being delete-then-recreate). Editability adds a
PATCH/PUT endpoint, an edit form, inline-edit UI, and tests. Delete
+ re-add covers the same user need with a smaller surface.

Current behavior / what's causing it:
No edit path exists. The four declared features are Save, List,
Open, Delete — editing is not in the list. For a personal bookmark
store, the workflow "delete the wrong one, add the right one" is
acceptable and matches the seed's minimalism.

Options:
  (YES) [M, Med] Allow edit — new endpoint, edit form, inline UI, extra tests
  (NO)  [S, Low] Immutable — edits happen via delete + re-add; matches the four-feature scope

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Med | New mutation endpoint + edit UI; surface grows past the four declared features. |
| NO  | S | Low | Bookmarks are write-once; user deletes and re-adds to fix a typo. |

**Recommendation:** NO — keeps the four-feature surface clean
**Why not the other:** YES expands the API and UI beyond what the seed asked for.

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q04 -->
Immutable once added (no edit)
<!-- loom:answer-slot end id=Q04 -->

---

## Q05 [Y/N]: Do we need a sort order other than newest-first?
<!-- loom:question version=1 id=Q05 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q01, Q03]

What's the issue:
The seed asks whether the list view needs sort options beyond
newest-first (e.g. alphabetical by title, oldest-first, by tag).
With Q01 = flat list (no tags) and Q03 = no search, the list is a
single newest-first scroll. Adding a sort selector means a control
in the UI, a server query parameter or a client-side sort, and
tests.

Current behavior / what's causing it:
No list view exists. Newest-first is the natural default for a
chronological capture flow: the bookmark you just saved is the one
you most likely want to find again immediately. Alphabetical sort
matters mostly when the list is large enough that scanning fails —
not the case here.

Options:
  (YES) [M, Med] Add a sort selector — multiple orderings, new UI control, server or client sort
  (NO)  [S, Low] Newest-first only — single ordering, matches the four-feature scope

**Options at a glance**

| Option | Effort | Risk | Result |
| --- | --- | --- | --- |
| YES | M | Med | Sort dropdown wired to ORDER BY; extra UI + tests; surface grows. |
| NO  | S | Low | Bookmarks always render newest-first by created_at; one ORDER BY in one query. |

**Recommendation:** NO — newest-first is the natural default and keeps the surface small
**Why not the other:** YES is sort UI the seed didn't ask for and the user can live without at this scale.

- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q05 -->
Newest-first only
<!-- loom:answer-slot end id=Q05 -->

---

## Side requirements (running)

(none recorded this dispatch)

---

## Deferred clarifications

(none — Spec returns `complete`; no `[NEEDS CLARIFICATION]` markers.)
