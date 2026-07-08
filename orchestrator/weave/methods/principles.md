# Engineering Principles

Enforceable rules for every code-touching Loom subagent (Build phase agent, Review Audit Agent). Read before any work-loop step. Per-project `spec.md ## Constraints` override these on conflict.

---

## Right-size ceremony, never quality

A project's depth (`pipeline.md.Spec depth`: light / standard / deep) governs how much *ceremony* a ticket gets — how many artifacts, sections, and questions — and nothing else.

- The quality bar is FIXED at every depth. Principles P1–P7, Review severities, the trust-boundary validation / security / data-loss / accessibility carve-outs, and the requirement to state what was verified never relax.
- Depth may reduce documents and prose; it NEVER reduces planning, rationale capture, or validation.
- When unsure of a ticket's depth, choose heavier — a mis-scoped "light" is far more expensive than a mis-scoped "deep".
- Depth is set by BLAST RADIUS (auth, money, shared state, data loss, production exposure, integration surface), not by diff size: a one-line change to a trust boundary is not light.

## Marking deliberate shortcuts

Mirrors Loom's existing `loom:` comment markers (e.g. `loom:question`). When you deliberately simplify with a known ceiling, leave a one-line marker at the site using the language-appropriate comment prefix (`//`, `#`, `--`, …):

```
loom:shortcut <ceiling>; <upgrade-trigger>
```

- `<ceiling>`: the limit this simplification is correct up to (e.g. "fine to ~1k rows", "single-process only").
- `<upgrade-trigger>`: the concrete condition to revisit (e.g. "revisit if multi-process", "when p95 > 200ms").

Rules:
- ONE line. Only for DELIBERATE simplifications with a known ceiling — not TODOs, not bugs, not unfinished work.
- Anchor to conditions, NOT owner names or dates (they go stale).
- A marker missing an upgrade-trigger is allowed but is flagged as a rot risk when Review harvests markers.
- Keep it minimal — heavy structure kills adoption.

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
- **Search before writing.** Before introducing a pattern, grep / read the codebase for the closest prior art and match it. Use the agent's own Read / Grep / Bash tools inline — do not dispatch a subagent for this. If a `.loom/<project>/repo-context.md` is present (user-maintained — see `methods/repo-context.md`), read it first; otherwise go straight to agentic search.
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
- **Extend, don't copy.** When a new unit (class, getter, test, config block) would differ from an existing one by a small delta, extend or parameterize the existing one instead of copying it. P2's nearest-neighbor rule governs naming and shape — it never justifies a new copy of existing code, and "this pattern already repeats in the file" is not a differing context.
- **Don't copy-paste error messages, validation rules, or constants.** These belong in single sources of truth (constants module, validation schema, message catalog).
- **Don't copy-paste tests.** If two tests are 90% the same, parameterize.

**Self-check during implementation:** *"Have I written this same shape of code already in this PR or earlier in this file? If yes, extract."*

**Review check:** scan the diff for repeated structural patterns. Three substantially-similar code blocks anywhere in the diff = MAJOR finding. A new unit that is a near-copy of an existing one = MAJOR, regardless of how many copies predate the diff.

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
- **New tests pin unpinned behaviour.** Before adding a test, name the existing test or golden that covers the behaviour at that layer; if one exists, extend it. Asserting instance identity, query shapes, or other internals that a public-interface test already covers is structural.

**Review check:** flag tests that mock internal classes, assert on internal call counts, or have names tied to method names rather than behaviour. Also flag tests that re-assert behaviour an existing test or golden already pins at the same layer.

---

## P7 — Don't fight the framework

**If the framework solves it, use the framework. If you're hand-rolling something the framework provides, stop.**

Concrete rules:
- HTTP routing, request validation, dependency injection, ORM relationships, auth middleware, serialization — use the framework's built-ins unless the spec says otherwise.
- Don't write a wrapper around the framework "to make it cleaner." The framework is the contract; wrappers fragment knowledge.
- If you find yourself working *around* the framework rather than *with* it, stop and surface the friction as a HITL question — don't write a workaround.

**Review check:** flag any custom implementation that duplicates a documented framework feature.

---

## Review checklist

The Review Audit Agent uses these as a structured checklist. Each principle has its "flag if" rule from the sections above. Findings categorise:

- **Blocker:** P1 if a clear scope violation; P3 if duplication is 3+ instances; P4 if `legacy*` naming or commented-out code lands.
- **Major:** P2 mismatch with existing conventions; P3 near-copy of an existing unit; P5 unused abstraction with no consumer; P6 internal mocking or redundant coverage.
- **Minor:** stylistic deviations within a principle's spirit.

Findings triage — decide what each finding demands before writing it:

- **Mechanical** — behaviour-preserving, no regression surface, tests prove it (a copy where an extension exists, dead flexibility, solved-elsewhere code): the finding's Recommendation states "apply, no decision needed".
- **Material and debatable** — affects behaviour, scope, public API, data, or a real trade-off: full finding for the gate.
- **Debatable but trivial** — a taste-level call whose benefit is a few lines: not a finding. The status quo wins; omit it.

Project-level `spec.md ## Constraints` entries take precedence over the matching principle when both apply.
