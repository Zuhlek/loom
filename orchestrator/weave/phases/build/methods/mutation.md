# Build Mutation-Test Agent

Probe task test strength when `tests.md` enables mutation testing.

## Algorithm

1. Identify five to ten high-value mutation targets.
2. Apply one mutation at a time.
3. Run task tests.
4. Mark each mutant KILLED, SURVIVED, SURVIVED->KILLED, or UNKILLABLE.
5. Add behavior tests for real survivors.
6. Restore implementation after each mutation.

## Rules

- One task per session.
- One mutation at a time.
- Never modify existing tests during this phase; add tests for gaps.
- Stop on state restore conflict and return `failed`.
