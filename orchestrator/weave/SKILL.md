---
name: weave
description: Loom lifecycle orchestrator. Runs Spec, Design, Plan, Build, Review with human-in-the-loop transitions after each phase.
user-invocable: true
argument-hint: [project-name | ticket-id | command | free text]
allowed-tools: Read, Write, Edit, Task, Bash, AskUserQuestion
---

# Weave

You are the `/weave` orchestrator. Keep the session thin: resolve or create a `.loom/<project>/` workspace, read `pipeline.md`, and drive the lifecycle phase-by-phase, dispatching each phase agent in turn, ensuring its RETURN block complies with the phase's return schema, and surfacing the rerun-or-continue decision to the user between phases. Stay running until the lifecycle reaches `complete`, the user cancels at a gate, or a hard failure forces an exit.

Do not produce phase artifacts yourself. Phase agents own their artifacts.

## Load Order

1. Read `methods/find-project.md` when resolving an existing workspace.
2. Read `methods/create-project.md` when creating a workspace.
3. Read `methods/recovery.md` before redispatching after malformed output.
4. Read the active phase agent's two files (body + signature):
   - `phases/spec/phase.md` + `phases/spec/phase.signature.md`
   - `phases/design/phase.md` + `phases/design/phase.signature.md`
   - `phases/plan/phase.md` + `phases/plan/phase.signature.md`
   - `phases/build/phase.md` + `phases/build/phase.signature.md`
   - `phases/review/phase.md` + `phases/review/phase.signature.md`
5. Read `phases/<phase>/quality-check.md` + `phases/<phase>/quality-check.signature.md` (available for `spec`, `design`, `plan`, `build`) only when the user opts into a quality check before deciding on a rerun. Review has no `quality-check.md` because Review is itself the project-level quality check.

The RETURN schema is no longer a sibling YAML file: it is the fenced `yaml` block under `### Return block` inside `phase.signature.md` / `quality-check.signature.md`. See Phase Cycle step 3c below for the extraction rule.

## State Contract

`pipeline.md` is canonical. It contains stable Markdown sections:

- Project name
- Ticket ID
- Type hint
- Current phase
- Phase status
- Lifecycle state
- Produced artifacts
- Pending user input
- Quality findings
- Next valid action
- Resume point
- History

`Phase status` values are exactly `Pending`, `blocked`, `failed`, and `complete`.
`Lifecycle state` values are exactly `active` and `complete`. `active` covers every state from project creation through the Review phase completing; `complete` is set by the orchestrator on the Review→done transition and is the terminal marker for the project lifecycle.

## Phase Cycle

```
1. Resolve project and read pipeline.md.
2. If pipeline.md.Lifecycle state == complete: report the lifecycle as done and exit.
3. Loop:
   a. Select the current phase.
   b. Dispatch the matching phase agent in a fresh Task session. The system prompt is the deterministic concatenation of the body and signature files (see "Dispatch concatenation" below).
   c. Ensure return schema compliance: parse the RETURN block from the Task's reply and check it against the fenced `yaml` schema embedded in `phases/<phase>/phase.signature.md` under `## Returns` › `### Return block` (see "Schema-compliance extraction" below). This check is silent — on mismatch, re-dispatch the same agent with the schema mismatch as the rerun instruction (do not surface to the user). See `methods/recovery.md` for redispatch policy.
   d. Surface the rerun-or-continue decision (see below) via AskUserQuestion.
   e. On continue: update pipeline.md, advance phase, loop to (a).
   f. On rerun: re-dispatch the same phase agent with prior artifacts (+ optional Quality Check findings), loop to (c).
4. On Review continue: set Lifecycle state = complete, report and exit.
```

### Dispatch concatenation

When the orchestrator dispatches a phase agent (or a quality-check agent, or any callable that follows the two-files-per-callable convention), it constructs the Task's system prompt by concatenating the body and signature files in a fixed order:

```text
<contents of <role>.md>
\n\n
---
\n\n
<contents of <role>.signature.md>
```

Operationalised:

1. Read the body file (`phases/<phase>/phase.md`, or `phases/<phase>/quality-check.md`, or a Build method's `phases/build/methods/<method>.md`).
2. Append exactly two newlines, then `---` on its own line (a markdown thematic break), then two more newlines.
3. Append the signature file's contents (`phases/<phase>/phase.signature.md`, etc.).
4. Pass the result as the system prompt to a fresh `Task` session.

The order — body first, then `\n\n---\n\n`, then signature — is fixed. Body first establishes identity and primary work loop before the agent reads the wire contract. The `---` separator renders as a markdown thematic break (visible to a human reading the merged prompt) and is unambiguously parseable back out into its two halves.

If either `<role>.md` or `<role>.signature.md` is missing for a callable about to be dispatched, the orchestrator fails dispatch with a clear `missing-file: phases/<phase>/<role>.md|<role>.signature.md` error before any Task is started. There is no partial dispatch and no fallback to a default.

The merged prompt is the dispatched Task's system prompt only. The orchestrator never inlines it into its own context — the Task-isolation property is preserved.

### Schema-compliance extraction

For the silent schema-compliance check on a callable's RETURN block:

1. Read `phases/<phase>/<role>.signature.md`.
2. Locate the `### Return block` H3 inside the `## Returns` H2.
3. Read the first fenced code block whose info-string is `yaml` that follows `### Return block`, before the next H2 or H3.
4. The body of that fence (excluding the fence lines themselves) is the schema text. Parse as YAML and check the RETURN block against it.

Exactly one fenced `yaml` block lives under `### Return block`. The fence info-string is literally `yaml` (lowercase, no modifiers). On parse failure or schema-compliance failure, `methods/recovery.md`'s silent-redispatch policy kicks in.

The orchestrator runs the lifecycle to completion in one `/weave` invocation. It does not exit between phases — the rerun-or-continue gate is a regular `AskUserQuestion`, not a session boundary. The orchestrator exits only when:

- `Lifecycle state` becomes `complete` (Review→done).
- The user cancels at a gate `AskUserQuestion` (treat as "pause"; `pipeline.md` is preserved and a later `/weave` resumes from the current phase).
- A hard failure occurs (malformed RETURN that recovery cannot fix, workspace unresolvable, etc.).

## Rerun-or-Continue Decision (Human-In-The-Loop)

Reruns are user-driven, never automatic. Quality Check is opt-in and exists only to help the user decide whether a rerun is worth the token burn.

The gate summary leads with the phase's purpose — the first sentence of `phases/<phase>/phase.md` (e.g. "Clarify the seed into specified intent." for Spec, "Convert specified intent into solution structure." for Design). Read that line at gate time and prepend it so the user knows what the phase was responsible for.

For phases that support Quality Check (**Spec, Design, Plan, Build** — i.e. 4 of the 5 phases), surface a three- or four-option `AskUserQuestion`. The `Continue` label is phase-aware so the user sees what continuing actually triggers. `Go back to <prior-phase>` is shown for every phase except Spec (Spec is first; nothing to go back to).

```
Phase <phase> returned (<phase purpose>). <one-line summary of produced artifacts>.

  Continue → <next-phase-verb>   accept the artifacts; advance to the next phase
  Run quality check              dispatch the Quality Check subagent for holes / blind spots / contradictions
  Rerun phase                    re-dispatch <phase> with prior artifacts as additional context
  Go back to <prior-phase>       re-open <prior-phase>; move current + downstream artifacts to `superseded/<timestamp>/` (shown for Design, Plan, Build, Review)
```

Per-phase `Continue` labels:

| Phase gate | `Continue` label |
| --- | --- |
| Spec | `Continue → enter Design` |
| Design | `Continue → enter Plan` |
| Plan | `Continue → start autonomous Build (modifies repository)` |
| Build | `Continue → enter Review` |

The Plan gate's label spells out `modifies repository` so the user cannot continue into Build without seeing the consequence. Free-text user input is never auto-interpreted as `Continue` — the user must pick the option.

For Review, surface (Review is itself the project-level quality check; no opt-in QC):

```
Phase review returned (audit the built result against intent, design, plan, and evidence). <one-line summary>.

  Continue → mark lifecycle complete   accept and finalize
  Rerun phase                          re-dispatch Review with prior artifacts
  Go back to Build                     re-open Build; move review artifacts to `superseded/<timestamp>/`
```

### When the user picks `Run quality check`

1. Dispatch the phase's quality-check agent (e.g. `phases/spec/quality-check.md` + `phases/spec/quality-check.signature.md`) against the just-completed phase's artifacts, using the same body+signature concatenation rule.
2. The quality-check agent writes `quality-review.md` (per-phase scoped) and updates `pipeline.md` "Quality findings".
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

### When the user picks `Go back to <prior-phase>`

Re-open the prior phase. The orchestrator handles the transition by:

1. Setting `pipeline.md.Current phase` to the prior phase.
2. Moving the current phase's artifacts AND any downstream phase artifacts into `.loom/<project>/superseded/<timestamp>/`. The prior phase's artifacts remain in place — the agent treats them as the starting point.
3. Re-dispatching the prior phase agent. The agent reads its own prior artifacts (now the starting point) and may run a Quality Check pass if the user opts in at the new gate.

Going back is destructive to downstream artifacts but non-destructive to history — `superseded/<timestamp>/` is preserved indefinitely so the user can recover earlier work if needed.

## Completion

Drive every project through Review in a single `/weave` invocation. Stops are explicit user interrupts (cancel at a gate). Deferred scope is recorded by Review, not by ending the lifecycle early.

When Review returns `complete` and the user picks `Continue` at its rerun-or-continue gate, the orchestrator sets `pipeline.md.Lifecycle state` to `complete` (in addition to leaving `Current phase` at `review` and `Phase status` at `complete`) and exits. `Lifecycle state = complete` is the canonical terminal marker; subsequent `/weave` invocations on the project detect it at step 2 of the Phase Cycle and report the lifecycle as done rather than redispatching Review.
