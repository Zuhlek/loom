# Engineering Principles

> **What this is:** the default engineering principles every code-touching Loom subagent (Build phase agent, Review Audit Agent) operates under. These are *enforceable rules*, not vibes.
>
> **Where it lives:** `weave/methods/principles.md` (in the weave skill base) — team-shared, inlined into the Build and Review dispatch heads via each phase body's `## Reads`. Per-project invariants and overrides live in the project's `spec.md ## Constraints` section, which the Build phase agent and Review Audit Agent both read as part of their input context. A Constraint wins over a principle on conflict.
>
> **How agents pick this up:** subagent-pull, not orchestrator-push. The Build phase agent (via [`weave/phases/build/methods/task.md`](weave/phases/build/methods/task.md)) and the Review Audit Agent (via [`weave/phases/review/phase.md`](weave/phases/review/phase.md)) each open with a "Reads first" instruction pointing here. They read this file before any work-loop step. The orchestrator never injects this file into dispatch prompts.
>
> **Why it exists:** without explicit, enforceable principles, the agent will introduce duplication, leave dead code, add backwards-compat shims, and drift from the codebase's existing conventions. These failures aren't taste — they're predictable consequences of an agent generating code without anchored constraints.

---

## P1 — Lean changes, especially against existing code

**Default: the smallest diff that achieves the task's acceptance criteria. Nothing more.**

Concrete rules:
- Don't refactor adjacent code "while you're there." If the task's `files-likely-touched` list doesn't name a file, don't change it. If you find a real issue in adjacent code, file a follow-up task — don't fix it inline.
- Don't expand a function's signature, return type, or responsibility beyond what the task requires.
- Don't add abstractions for hypothetical future needs. Three similar lines beat a premature helper.
- Don't add error handling for impossible cases. Trust internal invariants and framework guarantees. Validate only at system boundaries (user input, external APIs, untrusted serialized data).

**Self-check during implementation:** *"If I removed this line, would a documented requirement (acceptance criterion, test) start failing? If no, the line probably shouldn't have been added."*

**Review check:** every line in the diff must trace to an acceptance criterion in the task spec or to an entry in `spec.md ## Constraints`. Lines that trace to neither are flagged MAJOR.

---

## P2 — Existing patterns, libraries, and conventions first

**Before writing new code, find the prior art.**

Concrete rules:
- **Search before writing.** When implementing a task, dispatch an `Explore` subagent with the prompt: *"Find the closest prior art in this codebase for [pattern]. Return file paths and a one-paragraph summary of the pattern, ≤300 words."* Read the summary; match the pattern.
- **Naming conventions are non-negotiable.** Match the existing repo: snake_case vs camelCase, `getUser` vs `fetch_user` vs `find_user`, `User` vs `UserDto` vs `UserModel`. If the repo is inconsistent, match the closest neighbor (the file you're modifying, or the nearest sibling module).
- **Use libraries already on the manifest.** Don't add new dependencies (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.) without explicit justification in the task spec. New deps require a HITL approval, not an autonomous agent decision.
- **Match existing test style.** If the repo uses pytest fixtures, don't introduce unittest classes. If tests are integration-style hitting real DB, don't introduce mocked unit tests. If the repo uses BDD (`describe/it`), don't switch to `test_xxx`.
- **Match existing logging, error handling, config patterns.** If the repo uses structured logging via Winston, don't `console.log`. If errors are typed via Result types, don't throw bare exceptions.

**Self-check during implementation:** *"If a senior engineer on this team opened a blame on this line a year from now, would they recognise the style as theirs?"*

**Review check:** flag any new pattern that has equivalent prior art elsewhere in the codebase. Flag any new dependency that wasn't on the manifest before this task.

---

## P3 — Zero duplication

**Before copy-pasting, extract. Before extracting, check if it's already extracted.**

Concrete rules:
- **2 occurrences allowed if contexts genuinely differ.** Two database query helpers that both filter by `user_id` but live in different bounded contexts can stay separate.
- **3+ occurrences require extraction.** No exceptions. Find or create a helper.
- **Before writing a helper, search.** The repo probably already has the pattern. Use it instead of duplicating.
- **Don't copy-paste error messages, validation rules, or constants.** These belong in single sources of truth (constants module, validation schema, message catalog).
- **Don't copy-paste tests.** If two tests are 90% the same, parameterize.

**Self-check during implementation:** *"Have I written this same shape of code already in this PR or earlier in this file? If yes, extract."*

**Review check:** scan the diff for repeated structural patterns. Three substantially-similar code blocks anywhere in the diff = MAJOR finding.

---

## P4 — One clean implementation, no backwards-compat shims

**When changing existing code, replace it. The current name is the only name.**

Concrete rules:
- **No `oldFn` / `legacyXyz` / `XyzV2` / `*Old` / `*Deprecated` naming.** When you rename, update every caller and delete the old. There is no "transition period" inside one PR.
- **No dual implementations behind feature flags** unless the task spec explicitly requires it (e.g., a staged rollout).
- **No commented-out code.** Delete it. Git remembers.
- **No `// removed because X` / `// kept for compatibility` comments.** Delete the code; the commit message holds the why.
- **No "keeping the old function as a wrapper that calls the new one"** unless external callers can't be updated in this PR.
- **No `if (LEGACY_MODE)` branches** added without a corresponding plan to remove them, with the removal task filed before this task ships.

When backwards compatibility *is* genuinely required (public API, persisted data format), it must be:
- Called out explicitly in the task spec (`Acceptance criteria` includes a back-compat clause).
- Time-bounded — the task spec names the follow-up task that removes the old path.

**Self-check during implementation:** *"If I were the only engineer who would ever read this code again, would I leave both the old and the new path? No. Then don't."*

**Review check:** flag any of: `legacy*`, `*V1`/`*V2`/`*Old`/`*Deprecated` naming, commented-out blocks, "kept for X" comments, parallel old/new code paths without an explicit migration task.

---

## P5 — No speculative scaffolding

**Every new file, abstraction, config knob, or utility must be exercised by code that exists in *this* PR.**

Concrete rules:
- Don't add a config field that nothing reads.
- Don't add an interface with a single implementation "in case we need to swap later."
- Don't add a base class for a hierarchy of one.
- Don't add hooks/events/extension points unless the spec names a current consumer.
- Don't add tests for behaviors the spec doesn't list.
- Don't expose helpers from a module unless someone outside the module calls them; keep them private.

**Self-check during implementation:** *"What concrete code in this PR uses this new thing? If the answer is 'nothing yet, but later…', delete the new thing."*

**Review check:** flag any new abstraction without ≥1 concrete consumer in the same diff. Flag any new config field without a code path that reads it.

---

## P6 — Tests describe behaviour, not structure

**Tests verify *what* the system does through public interfaces, not *how* it does it.**

Concrete rules:
- Tests should survive internal refactors. If renaming a private helper breaks a test, the test was structural, not behavioural.
- Tests assert on **return values, state changes, exceptions** — never on whether a specific internal method was called.
- Mocks are for **external boundaries** (HTTP, DB if testing in-memory replacement, file system, time). Never mock internal collaborators.
- Test names describe the user-facing behaviour: `"returns 404 when product not found"`, not `"productService_returns_null_then_throws"`.

**Review check:** flag tests that mock internal classes, assert on internal call counts, or have names tied to method names rather than behaviour.

---

## P7 — Don't fight the framework

**If the framework solves it, use the framework. If you're hand-rolling something the framework provides, stop.**

Concrete rules:
- HTTP routing, request validation, dependency injection, ORM relationships, auth middleware, serialization — use the framework's built-ins unless the spec says otherwise.
- Don't write a wrapper around the framework "to make it cleaner." The framework is the contract; wrappers fragment knowledge.
- If you find yourself working *around* the framework rather than *with* it, stop and surface the friction as a HITL question — don't write a workaround.

**Review check:** flag any custom implementation that duplicates a documented framework feature.

---

## How code-touching agents pick this up

Subagent-pull. The orchestrator never injects this file into dispatch prompts.

| Agent | Operating spec | Pickup mechanism |
| --- | --- | --- |
| Build phase agent | [`weave/phases/build/methods/task.md`](weave/phases/build/methods/task.md) | Opens with a `## Reads first` section instructing the agent to read this file before the first task, and keep it loaded across every task in the session. |
| Review Audit Agent | [`weave/phases/review/phase.md`](weave/phases/review/phase.md) | Same — opens with `## Reads first` + a dedicated `Principle compliance` Review Target that applies the per-principle Review checks below. |

Spec / Design / Plan don't touch code and don't read this file.

### Review checklist

The Review Audit Agent uses these as a structured checklist. Each principle has its "flag if" rule from the sections above. Findings categorise:

- **Blocker:** P1 if a clear scope violation; P3 if duplication is 3+ instances; P4 if `legacy*` naming or commented-out code lands.
- **Major:** P2 mismatch with existing conventions; P5 unused abstraction with no consumer; P6 internal mocking.
- **Minor:** stylistic deviations within a principle's spirit.

Project-level `spec.md ## Constraints` entries take precedence over the matching principle when both apply for a given project. The Spec / Design phases are responsible for surfacing those Constraints; the Build phase agent and Review Audit Agent both read `spec.md` as part of their input context.

---

## TL;DR

Seven enforceable principles, all with concrete rules and review checks:

1. **Lean changes** — smallest diff, no drive-by refactors.
2. **Existing patterns first** — prior art before new code, match conventions, no new deps without justification.
3. **Zero duplication** — 3+ instances = extract.
4. **One clean implementation** — no `legacy*`, no commented-out blocks, no parallel old/new paths.
5. **No speculative scaffolding** — every new thing must have a current consumer.
6. **Tests verify behaviour** — public interfaces, no internal mocking.
7. **Don't fight the framework** — use built-ins, no wrappers.

Read by the Build phase agent and Review Audit Agent on dispatch (their operating specs instruct them to). Used as a structured checklist by Review. Per-project overrides live in `spec.md ## Constraints` — a Constraint wins over a principle on conflict.
