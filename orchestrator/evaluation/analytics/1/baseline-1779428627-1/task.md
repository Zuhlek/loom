---
project: baseline-1779428627-1
phase: plan
created: 2026-05-22
---

# Task Index — baseline-1779428627-1

Index of tasks created by Plan. Authoritative shape lives in
`tasks/T-NNN.md`; this file is a quick scan of ids, titles, status,
dependencies, and story coverage.

## Tasks

| ID | Title | Type | Status | Blocked by | Satisfies |
| --- | --- | --- | --- | --- | --- |
| T-001 | Scaffold app workspace with TypeScript + Vitest + esbuild | AFK | Backlog | — | US-001, US-002, US-003, US-004 |
| T-002 | SQLite repository + schema migration | AFK | Backlog | T-001 | US-001, US-002, US-004 |
| T-003 | Server validation rules + error taxonomy | AFK | Backlog | T-002 | US-001, US-004 |
| T-004 | HTTP routes for list/create/delete | AFK | Backlog | T-003 | US-001, US-002, US-004 |
| T-005 | Static HTML shell + CSS | AFK | Backlog | T-001 | US-002, US-003 |
| T-006 | Client API client + list rendering | AFK | Backlog | T-005 | US-002, US-003 |
| T-007 | Client create form behaviour with inline errors | AFK | Backlog | T-004, T-006 | US-001 |
| T-008 | Client per-row delete behaviour | AFK | Backlog | T-004, T-006 | US-004 |
| T-009 | Server entry + esbuild build wiring binds localhost:3000 | AFK | Backlog | T-004 | US-001, US-002, US-003, US-004 |

## Story → tasks

| Story | Tasks |
| --- | --- |
| US-001 Save a Bookmark With a Title | T-001, T-002, T-003, T-004, T-007, T-009 |
| US-002 View All Saved Bookmarks | T-001, T-002, T-004, T-005, T-006, T-009 |
| US-003 Open a Bookmark in a New Tab | T-001, T-005, T-006, T-009 |
| US-004 Delete a Bookmark | T-001, T-002, T-003, T-004, T-008, T-009 |

## Counts

- Total tasks: 9
- AFK: 9
- HITL: 0
