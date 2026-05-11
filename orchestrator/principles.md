# Engineering Principles

These rules load into code-touching agents and are used by Review as a checklist. Project-specific `constitution.md` wins on conflict.

## P1 - Lean Changes

Use the smallest diff that satisfies the task acceptance criteria.

- Do not change adjacent code unless the task requires it.
- Do not expand signatures or responsibilities beyond the task.
- Do not add abstractions for hypothetical future work.
- Validate at system boundaries, not trusted internal calls.

Review flags lines that do not trace to a task criterion or constitution rule.

## P2 - Existing Patterns First

Find prior art before writing new code.

- Match naming, libraries, test style, logging, configuration, and error handling.
- Add dependencies only when the task explicitly justifies them.
- Use the closest local pattern when the repo is inconsistent.

Review flags new patterns that duplicate established ones.

## P3 - Zero Duplication

Avoid repeated logic.

- Two similar occurrences may stay separate when contexts differ.
- Three or more similar occurrences require extraction or reuse.
- Search for existing helpers before creating one.
- Parameterize repeated tests.

Review flags repeated structural patterns in the diff.

## P4 - One Clean Implementation

Replace old paths instead of keeping parallel ones.

- No `legacy*`, `*V2`, `*Old`, or `*Deprecated` naming.
- No commented-out code.
- No wrapper path unless external callers cannot be updated in the same task.
- Required compatibility must be explicit in the task and time-bounded.

Review flags parallel implementations without an accepted reason.

## P5 - No Speculative Surface

Every new file, abstraction, config field, hook, or helper must have a current consumer.

Review flags unused structure.

## P6 - Behavior Tests

Tests verify public behavior, not internals.

- Assert return values, state changes, errors, and observable effects.
- Mock external boundaries only.
- Test names describe user-visible behavior.

Review flags tests coupled to private implementation.

## P7 - Use The Framework

Use framework-provided routing, validation, dependency injection, persistence, auth, serialization, and testing patterns where available.

Review flags custom implementations that duplicate framework capabilities.

## Build Preamble

```markdown
ENGINEERING PRINCIPLES

1. Lean changes. Smallest diff for the task acceptance criteria.
2. Existing patterns first. Find prior art and match local conventions.
3. Zero duplication. Three similar occurrences require reuse or extraction.
4. One clean implementation. No parallel old/new paths without explicit scope.
5. No speculative surface. Every new thing needs a current consumer.
6. Behavior tests. Public interfaces only; no internal mocking.
7. Use the framework. Do not hand-roll built-in capabilities.

Read `loom/principles.md`, `loom/types/<type>.md` when Type hint is set, and `.loom/<project>/constitution.md` when present.
```
