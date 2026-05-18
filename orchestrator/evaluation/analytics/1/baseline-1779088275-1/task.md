---
project: baseline-1779088275-1
phase: plan
created: 2026-05-18
---

# Task index — baseline-1779088275-1

Index of `tasks/T-*.md` plus the `T-NNN` → `US-NNN` mapping.

## Tasks

| ID | Title | Type | Status | Blocked by | Satisfies stories | Layers |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | Workspace scaffold and run contracts | AFK | Backlog | — | (foundation — see task file) | tooling |
| T-002 | List bookmarks end-to-end (empty + populated) | AFK | Backlog | T-001 | US-002 | db, repo, routes, server, client-api, client-render, client-main, client-html, client-css, tests |
| T-003 | Save a bookmark end-to-end with inline validation and dedupe | AFK | Backlog | T-001, T-002 | US-001 | validation, repo, routes, client-api, client-render, client-main, tests |
| T-004 | Open a bookmark in a new tab from the list | AFK | Backlog | T-001, T-002 | US-003 | client-render, client-main, tests |
| T-005 | Delete a bookmark end-to-end with idempotent no-op | AFK | Backlog | T-001, T-002 | US-004 | repo, routes, client-api, client-render, client-main, tests |

## Story coverage

| Story | Covered by |
| --- | --- |
| US-001 | T-003 |
| US-002 | T-002 |
| US-003 | T-004 |
| US-004 | T-005 |

All four active user stories are covered. No story is double-counted in a way that would let a single task's failure invalidate two stories.

## Dependency DAG

```
T-001 ── T-002 ── T-003
              \── T-004
              \── T-005
```

Validated: every `blocked-by` resolves; no cycles; `T-001` is the only root; `T-003`, `T-004`, `T-005` are leaves and run in parallel after `T-002`.

## HITL count

Zero HITL tasks. All five tasks are `AFK` and runnable by the Build coordinator under the declared `node-test` verification environment.
