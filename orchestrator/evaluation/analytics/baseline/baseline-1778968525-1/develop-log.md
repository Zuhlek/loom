# Develop log — baseline-1778968525-1

## 2026-05-17 — Build pass

- Implemented all 10 tasks sequentially (test-first per task: write red, then implement, then green).
- 48 Vitest tests across 8 files all green. `tsc --noEmit` clean. `npm run build` produces `public/app.js` + sourcemap. `npm start` boots on `127.0.0.1:3000` and serves the four canonical operations end-to-end (verified live in `smoke-report.md`).
- No HITL touches required. No spec ambiguities surfaced.

## Learnings (lifted to orchestrator/log/build.md)

1. esbuild's `if (import.meta.url === \`file://${argv[1]}\`)` self-run guard breaks when the working path contains spaces — use a resolved-path compare. (Hit on this workspace because the path contains "My Shared Files".)
2. Express 5 widens `req.params[name]` to `string | string[]`; route handlers that regex against the param need a `typeof === 'string'` guard to satisfy `tsc --noEmit`.
3. better-sqlite3 unique-violation assertions are brittle against the message text across versions — assert on `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` instead.

## 2026-05-17 - baseline-1778968525-1 - review-pass-with-minor-findings

Review verdict: pass. 4 minor findings, 0 major, 0 blockers. All four
user stories satisfied end-to-end; spec constraints (workspace isolation,
stack pinning, localhost-only, SQLite + UNIQUE, same-origin, minimum
surface) all honoured. 48/48 Vitest green, `tsc --noEmit` clean, live
smoke probes confirm the four canonical operations + error envelopes.
Findings (F-1..F-4) are duplication/scaffolding-shaped and below the
blocker bar: client-side mirror validation, an unused `INVALID_BODY`
member in the `ValidationCode` union, a stylistically convoluted
`build.mjs` self-run guard, and a marginally redundant `httpStatusFor`
helper. None of these touch behaviour; all are deferrable to a
post-baseline cleanup task.

## 2026-05-17 - baseline-1778968525-1 - design-flex-points-collapsed-cleanly

Design flagged two "open ambiguity" items (SQLite file location;
server execution choice `tsx` vs compiled `dist/`). Build picked one
of each (`app/data/bookmarks.sqlite`; `tsx`) and neither downstream
task or test noticed. Validates the spec→design→plan→build handoff
shape: design notes flex points, plan pins one option, build executes
without re-litigating. Useful as a positive signal for the "flex
flagged at design, not deferred to build" pattern.

## 2026-05-17 - baseline-1778968525-1 - whitespace-in-workspace-path-hazard

Workspace path contains "My Shared Files" (a space). The esbuild
self-run guard pattern `if (import.meta.url === \`file://${argv[1]}\`)`
encoding-mismatched on the space (`%20` vs literal). Build resolved
both sides to filesystem paths via `resolve(...)`+`fileURLToPath(...)`
and the comparison works. Worth promoting to build-agent guidance so
this isn't re-discovered every workspace with a space in its path.

## 2026-05-17 - baseline-1778968525-1 - express-5-param-typing

Express 5 widens `req.params[name]` from `string` to `string | string[]`.
Route handlers that regex / Number-coerce the param need a
`typeof raw === 'string'` guard before any string method, or
`tsc --noEmit` fails. The delete route in this run has that guard and
the suite is green. Worth a pattern note for any future Express 5
task.

## 2026-05-17 - baseline-1778968525-1 - per-task-RED-GREEN-discipline

Every automated task produced a `tasks/T-NNN.test-log.txt` with both
RED (pre-implementation failure) and GREEN (post-implementation pass)
sections, and a `tasks/T-NNN.done.md` with frontmatter. The
non-automated task (T-008, declared in `tests.md`) recorded its
own deviation explicitly. No task needed retry. This is the shape
Review expects to audit; worth keeping as the canonical artifact pair.

