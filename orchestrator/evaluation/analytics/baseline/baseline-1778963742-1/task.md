---
project: baseline-1778963742-1
phase: plan
created: 2026-05-16
---

# Task index — baseline-1778963742-1

Single source of truth for task ordering, status, and dependency edges.
Per-task detail lives in `tasks/T-NNN.md`.

| ID    | Title                                                                              | Type | Status   | Blocked-by    | Satisfies                       |
| ----- | ---------------------------------------------------------------------------------- | ---- | -------- | ------------- | ------------------------------- |
| T-001 | Bootstrap app/ project skeleton and npm scripts                                    | AFK  | Backlog  | —             | (infra — unblocks T-002..T-005) |
| T-002 | Implement DB layer and bookmarks repository (URL normalisation + duplicate guard)  | AFK  | Backlog  | T-001         | US-001, US-002, US-004          |
| T-003 | Implement Express app factory, routes, and validation with supertest coverage      | AFK  | Backlog  | T-002         | US-001, US-002, US-004          |
| T-004 | Implement vanilla-TS client bundle (HTML, CSS, main.ts) via esbuild                | AFK  | Backlog  | T-001         | US-001, US-002, US-003, US-004  |
| T-005 | Wire server entrypoint and add end-to-end smoke test on ephemeral port             | AFK  | Backlog  | T-003, T-004  | US-001, US-002, US-003, US-004  |

Totals: 5 tasks · 5 AFK · 0 HITL.
