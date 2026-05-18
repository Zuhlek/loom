---
project: baseline-1779088265-1
phase: plan
created: 2026-05-18
---

# Task index — baseline-1779088265-1

Mirror of `tasks/T-*.md`. Single source of truth for task ID → story coverage.

## Tasks

| ID    | Title                                                      | Type | Status   | blocked-by                       | satisfies-stories          | touches-layers |
| ----- | ---------------------------------------------------------- | ---- | -------- | -------------------------------- | -------------------------- | -------------- |
| T-001 | Bootstrap workspace, tsconfigs, scripts, shared types      | AFK  | Backlog  | —                                | US-001, US-002, US-003, US-004 | workspace, shared-types |
| T-002 | Open SQLite and run schema migration                       | AFK  | Backlog  | T-001                            | US-001, US-002             | db |
| T-003 | Express app factory with JSON middleware and error handler | AFK  | Backlog  | T-001                            | US-001, US-002, US-003, US-004 | app, routes |
| T-004 | Save a bookmark end-to-end                                 | AFK  | Backlog  | T-002, T-003                     | US-001                     | repo, routes, client-api, client-form, client-render |
| T-005 | List bookmarks newest-first end-to-end                     | AFK  | Backlog  | T-002, T-003                     | US-002                     | repo, routes, client-api, client-render |
| T-006 | Open a bookmark in a new tab                               | AFK  | Backlog  | T-005                            | US-003                     | client-render, static |
| T-007 | Delete a bookmark end-to-end                               | AFK  | Backlog  | T-004, T-005                     | US-004                     | repo, routes, client-api, client-render |
| T-008 | Boot process, static shell, smoke gate                     | AFK  | Backlog  | T-004, T-005, T-006, T-007       | US-001, US-002, US-003, US-004 | boot, static, smoke |

## Story → Task coverage

| Story  | Covered by |
| ------ | ---------- |
| US-001 | T-001, T-003, T-004, T-008 |
| US-002 | T-001, T-002, T-003, T-005, T-008 |
| US-003 | T-006, T-008 |
| US-004 | T-003, T-007, T-008 |

Every active `US-NNN` from `spec.md` has at least one covering task. The graph is acyclic.

## Totals

- Total tasks: 8
- AFK: 8
- HITL: 0
