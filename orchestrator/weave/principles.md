# Engineering Principles

Rules for every code-touching agent (Build, Review). Per-project overrides live in `spec.md ## Constraints`; a Constraint wins on conflict.

1. **Lean changes.** Smallest diff that meets the acceptance criteria. No drive-by refactors, no error handling for impossible cases, validate only at system boundaries. Every line must trace to a criterion or constraint.
2. **Existing patterns first.** Find prior art before writing. Match the repo's naming, test style, logging, and error handling. No new dependencies without explicit user approval.
3. **Zero duplication.** Three or more similar blocks require extraction; search for an existing helper before writing one. Constants, messages, and validation rules have one source.
4. **One clean implementation.** No `legacy*`/`*V2`/`*Old` naming, no commented-out code, no parallel old/new paths. Back-compat only when the spec names it and the removal task.
5. **No speculative scaffolding.** Every new file, abstraction, or config knob needs a consumer in the same change. No interfaces with one implementation "for later".
6. **Tests verify behavior.** Assert on return values, state, and exceptions through public interfaces. Mock external boundaries only, never internal collaborators. Tests survive internal refactors.
7. **Don't fight the framework.** Use built-ins for routing, validation, DI, ORM, auth. No wrappers "to make it cleaner". Working around the framework is a blocked question, not a workaround.

Review severity: blocker for scope violations, 3+ duplication, legacy naming or committed dead code; major for convention mismatch, unused abstraction, internal mocking; minor for stylistic deviation.
