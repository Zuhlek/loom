# Build Log

## 2026-05-11 - loom-ui-phase-update - bunx-tsc-artifact-registry-fallback

Build noted that `bunx tsc --noEmit -p ui/apps/web` (the recipe in
`tests.md`) failed with an artifact-registry 404 in this environment;
the fallback was to invoke `./ui/node_modules/.bin/tsc` directly. Worth
documenting in the tooling contract so future Build phases don't lose
time rediscovering this. Recommend `tests.md` or the loom type docs
record a "if `bunx` registry is unreachable, fall back to the local
node_modules bin" line. The fallback worked cleanly — no other tooling
brittleness surfaced.

## 2026-05-11 - loom-ui-phase-update - server-tsc-error-baseline-diffing

Build documented a useful technique for working in a codebase with a
pre-existing TypeScript error baseline: rather than asserting "tsc
exits 0 after my edit," `git stash` the change, snapshot the error
count (67), apply the change, snapshot again, and assert the **delta is
zero**. This sidesteps a brittle "must clear all errors" gate that
would block legitimate work. Worth promoting to the build contract as
"when the project has a non-zero error baseline, gate on delta not
absolute."

## 2026-05-11 - phase-validators - build-7-task-dag-first-try-green

Build's task-builders implemented this in 7 parallel/sequential
subagent dispatches with no failures across all 91 acceptance gates —
every task green on attempt 1. The factors that produced this:

- `design.md` specified verbatim replacement text for every surface
  edit (SKILL.md / contract.md / README.md), and verbatim section
  content for every Idea-validator stanza to copy.
- `tests.md` specified the exact grep / `rg` / `test -f` assertion
  for every gate, so the Build executor had no judgment calls to
  make on what counts as PASS.
- The Plan slicing was per-validator-file + per-edited-file with no
  cross-file coupling; T-001 / T-002 / T-003 are sibling parallel
  tasks, and T-004 / T-005 / T-006 each touch one file each.
- The verification harness was pure `cli-shell` — no Node, no
  browser, no Python — so the Build executor's environment had zero
  setup friction.

Pattern to log: "when Design specifies verbatim text and Plan slices
one-file-per-task, Build becomes mechanical." Reusable shape for
future small refactors that are mostly docs / orchestrator
material. Worth holding up as a reference for "what shipping clean
on first attempt looks like."

