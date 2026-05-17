---
project: baseline-1778968525-1
phase: plan
created: 2026-05-17
---

# Task index — baseline-1778968525-1

This file lists every task at a glance. Per-task detail lives under `tasks/T-NNN.md`.

| ID    | Title                                                  | Type | Status   | Blocked by              | Satisfies stories         |
| ----- | ------------------------------------------------------ | ---- | -------- | ----------------------- | ------------------------- |
| T-001 | Workspace scaffolding                                  | AFK  | Backlog  | —                       | (foundation)              |
| T-002 | SQLite bootstrap and schema                            | AFK  | Backlog  | T-001                   | US-001, US-002, US-004    |
| T-003 | Bookmark repository (list/create/delete) + Vitest      | AFK  | Backlog  | T-002                   | US-001, US-002, US-004    |
| T-004 | Validation module + Vitest                             | AFK  | Backlog  | T-001                   | US-001                    |
| T-005 | Errors and Express app factory + error middleware      | AFK  | Backlog  | T-002, T-004            | US-001, US-004            |
| T-006 | Bookmark HTTP routes + supertest specs                 | AFK  | Backlog  | T-003, T-004, T-005     | US-001, US-002, US-004    |
| T-007 | Server bootstrap and static serving                    | AFK  | Backlog  | T-005, T-006            | US-002, US-003            |
| T-008 | UI shell (index.html, styles.css)                      | AFK  | Backlog  | T-001                   | US-002, US-003            |
| T-009 | Web bundle source (api/dom/types/main.ts)              | AFK  | Backlog  | T-006, T-008            | US-001, US-002, US-003, US-004 |
| T-010 | esbuild pipeline and npm scripts + smoke spec          | AFK  | Backlog  | T-007, T-009            | US-001, US-002, US-003, US-004 |

Totals: 10 tasks; 10 AFK; 0 HITL.
