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

