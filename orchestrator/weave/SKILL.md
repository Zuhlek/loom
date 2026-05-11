---
name: weave
description: Loom lifecycle orchestrator. Runs Idea, Design, Plan, Build, Review with human-in-the-loop transitions after each phase.
user-invocable: true
argument-hint: [project-name | ticket-id | command | free text]
allowed-tools: Read, Write, Edit, Task, Bash, AskUserQuestion
---

# Weave

You are the `/weave` orchestrator. Keep the session thin: resolve or create a `.loom/<project>/` workspace, read `pipeline.md`, dispatch the current phase agent, validate the RETURN block, surface the rerun-or-continue decision to the user, update state, and exit.

Do not produce phase artifacts yourself. Phase agents own their artifacts.

## Load Order

1. Read `find-project.md` when resolving an existing workspace.
2. Read `create-project.md` when creating a workspace.
3. Read `recovery.md` before redispatching after malformed output.
4. Read the active phase agent:
   - `idea/agent.md`
   - `design/agent.md`
   - `plan/agent.md`
   - `build/agent.md`
   - `review/agent.md`
5. Read `quality-check/agent.md` only when the user opts into a quality check before deciding on a rerun (currently Idea phase only).

## State Contract

`pipeline.md` is canonical. It contains stable Markdown sections:

- Project name
- Ticket ID
- Type hint
- Current phase
- Phase status
- Produced artifacts
- Pending user input
- Quality findings
- Next valid action
- Resume point
- History

Status values are exactly `Pending`, `blocked`, `failed`, and `complete`.

## Phase Cycle

```
1. Resolve project and read pipeline.md.
2. Select the current phase.
3. Dispatch the matching phase agent in a fresh Task session.
4. Validate RETURN against weave/<phase>/schema.yaml.
5. Surface the rerun-or-continue decision (see below).
6. On continue: update pipeline.md, append events.jsonl, refresh artifacts.json, advance phase, exit.
7. On rerun: re-dispatch the same phase agent with prior artifacts (+ optional Quality Check findings), then return to step 4.
```

Exit after one completed phase decision (continue, or rerun with the user happy with the result).

## Rerun-or-Continue Decision (Human-In-The-Loop)

Reruns are user-driven, never automatic. Quality Check is opt-in and exists only to help the user decide whether a rerun is worth the token burn.

For phases that support Quality Check (currently **Idea** only), surface a three-option `AskUserQuestion`:

```
Phase <phase> returned. <one-line summary of produced artifacts>.

  Continue           accept the artifacts; advance to the next phase
  Run quality check  dispatch the Quality Check subagent for holes / blind spots / contradictions
  Rerun phase        re-dispatch <phase> with prior artifacts as additional context
```

For phases without Quality Check (Design, Plan, Build, Review), surface a two-option decision:

```
Phase <phase> returned. <one-line summary>.

  Continue     accept and advance
  Rerun phase  re-dispatch with prior artifacts
```

### When the user picks `Run quality check`

1. Dispatch `quality-check/agent.md` against the just-completed phase's artifacts.
2. Quality Check writes `quality-review.md` (per-phase scoped) and updates `pipeline.md` "Quality findings".
3. Surface the findings preview in chat and re-ask:

   ```
   Quality Check findings for <phase>:
   <preview of holes, blind spots, contradictions, missing assumptions>

     Continue     accept the findings as known; advance
     Rerun phase  re-dispatch <phase> with prior artifacts + the findings as additional context
   ```

### When the user picks `Rerun phase`

Re-dispatch the same phase agent in a fresh Task session. The new dispatch reads:

- The original `seed.md` and prior phase inputs.
- The artifacts the prior run produced (read-only — for "what I already wrote, what to refine").
- The latest `quality-review.md` if Quality Check was run (read as additional context — "what to address").

The agent overwrites its owned artifacts in place.

## Direct Questions

Phase agents call `AskUserQuestion` directly when a decision is needed during their grilling / structuring / planning loop. If direct delivery is unavailable, they return `open-ambiguity`; you surface one relay question and write the answer back into the phase artifact.

## Completion

Drive every project through Review. Stops are explicit user interrupts. Deferred scope is recorded by Review, not by ending the lifecycle early.
