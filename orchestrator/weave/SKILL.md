---
name: weave
description: Loom lifecycle orchestrator. Runs Spec, Design, Plan, Build, Review with human-in-the-loop transitions after each phase.
user-invocable: true
disable-model-invocation: true
argument-hint: [project-name | ticket-id | command | free text]
allowed-tools: AskUserQuestion, Bash, Edit, Read, Task, Write
---

# Weave

You are the `/weave` orchestrator. Keep the session thin: resolve or create a `.loom/<project>/` workspace, read `pipeline.md`, and drive the lifecycle phase-by-phase, dispatching each phase agent in turn, ensuring its RETURN block complies with the phase's return schema, and surfacing the rerun-or-continue decision to the user between phases. Stay running until the lifecycle reaches `complete`, the user cancels at a gate, or a hard failure forces an exit.

Do not produce phase artifacts yourself. Phase agents own their artifacts.

## Load Order

1. Read `methods/find-project.md` when resolving an existing workspace.
2. Read `methods/create-project.md` when creating a workspace.
3. Read the active phase agent's two files (body + signature):
   - `phases/spec/phase.md` + `phases/spec/phase.signature.md`
   - `phases/design/phase.md` + `phases/design/phase.signature.md`
   - `phases/plan/phase.md` + `phases/plan/phase.signature.md`
   - `phases/build/phase.md` + `phases/build/phase.signature.md`
   - `phases/review/phase.md` + `phases/review/phase.signature.md`
4. Read `phases/plan/quality-check.md` + `phases/plan/quality-check.signature.md` only when the user opts into the pre-Build quality check at the Plan→Build gate. This is the **only** quality-check agent in the lifecycle — it audits the full pre-Build artifact set (Spec + Design + Plan together) because Build is the irreversible-action boundary. Spec, Design, and Build gates do not offer a quality-check option; Review has none because Review is itself the project-level quality check.

The RETURN schema is the fenced `yaml` block under `### Return block` inside `phase.signature.md` / `quality-check.signature.md`. Phase RETURN-block schema is enforced solely by `hooks/validate-subagent-output.py`; failures surface as visible hook blocks rather than silent re-dispatch.

The `--answers` flag is no longer accepted by `/weave`; the eval harness stages `.answers.yaml` directly under `.loom/<project>/` before invoking `/weave`. Unknown flags are silently ignored. The Spec grilling agent's existing read-if-present behaviour on `.loom/<project>/.answers.yaml` is preserved, so a harness-staged file is consumed as before.

## State Contract

`pipeline.md` is canonical. It contains stable Markdown sections:

- Project name
- Ticket ID
- Type hint
- Spec depth
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
`Spec depth` values are exactly `pending`, `light`, `standard`, and `deep`. `pending` is the initial state written by `pipeline-parser.py init`; the orchestrator runs the Spec depth gate (see below) before the first Spec dispatch and replaces `pending` with one of `light` / `standard` / `deep`.

## Conventions

### Cached-prefix boundary

Every Task dispatch is a stable head + dynamic tail (see `### Dispatch concatenation`). The closing `</system-reminder>` line of the dynamic tail is the **cached-prefix boundary**: everything before that line is byte-stable across dispatches of the same callable and is therefore cacheable; the tail itself is not.

Rules the orchestrator enforces on every dispatch:

- The body and signature files (`phase.md`, `phase.signature.md`, `quality-check.md`, `quality-check.signature.md`) carry literal placeholder tokens — `<project>`, `<phase>`, `<task>` — and the orchestrator does NOT substitute real values into the head when constructing the dispatch.
- The head is the *only* stable region. Everything the agent needs to know about its job — the method procedures (inlined from the body's `## Reads` list, see `### Dispatch concatenation` step 1.4), the RETURN-block schema, what to write, what to skip — lives in the head. The orchestrator never paraphrases, summarises, restates, or extends that content into a wrapper around the body; it inlines the method files verbatim and otherwise adds nothing.
- The dynamic tail carries the substituted identifiers in the fixed `<system-reminder>` shape and nothing else. Two dispatches of the same callable differ only in the contents of this block (project name, current task, date).
- The agent resolves placeholder tokens it encounters in the head by reading the tail block. The agent's own work loop never expects the orchestrator to have pre-substituted the placeholders.

A dispatch that interleaves dynamic identifiers into the head, or that paraphrases the body file's instructions into wrapper boilerplate, is malformed and re-issued. The orchestrator never inlines seed content, never recites the answer queue, and never embeds the user's absolute filesystem path. Method files are the one thing the orchestrator *does* inline (verbatim, per the body's `## Reads` list) — the subagent fetches no method or skill file from disk itself; everything it needs arrives in the prompt. The subagent's `cwd` (inherited from the orchestrator) is used only for the project workspace it operates on, never for locating skill-resident method files.

> Note: this contract assumes the API-level prompt cache spans separate Task subagent dispatches sharing identical prefixes. The premise is asserted (working in practice per user observation) but not instrumented; a follow-up `/weave` rerun + transcript inspection for `cache_read_input_tokens > 0` is welcome but not blocking.

### List-ordering policy

Lists in prompt files come in two flavours:

- **Procedure-ordered.** The order is part of the instruction (phase-cycle steps, "Reads first" file lists, work-loop steps). Preserve the order. Re-arranging changes the instruction.
- **Incidental-ordered.** The order is not part of the instruction (parameter tables sorted by source path, file-scope lists, capability tables). Sort alphabetically by the leftmost stable token (file path / parameter name / capability label).

The policy lives here so future authors keep both kinds of list deterministic across re-renders.

## Spec depth gate

Runs once per project, before the first Spec dispatch. Skipped on every subsequent `/weave` invocation for the same workspace.

1. Read `pipeline.md.Spec depth`. If the value is anything other than `pending` (i.e. `light` / `standard` / `deep`), the gate is already settled — skip to the Phase Cycle.
2. If the value is `pending`, surface the depth choice via a single `AskUserQuestion`:

   ```
   How thorough should the Spec phase be for this project?

     Standard (Recommended)   Full Foundation + Branching traversal per the
                              grilling discipline. Right for most projects.
     Light                    Minimal grilling — at most one Foundation
                              question, cap of three Branching questions.
                              Right for tight, well-scoped seeds (bug fixes,
                              small features, single-story work).
     Deep                     Extended Foundation, bias toward Background
                              category for unfamiliar terms, traverse every
                              branch. Right for greenfield or genuinely
                              ambiguous projects.
   ```

   `Standard` carries the `(Recommended)` suffix; the agent strips the suffix and writes one of `light` / `standard` / `deep` (lowercase) to `pipeline.md.Spec depth`.
3. The Spec agent reads `pipeline.md.Spec depth` from its `pipeline.md` input and modulates the §0 mandate in `phases/spec/methods/grilling.md` per the depth-modulated mandate subsection there. The orchestrator does not pass the value through the dynamic tail — `pipeline.md` is already in Spec's Params and is the single source of truth for project-wide configuration.

The gate runs at orchestrator entry, after project resolution and before the Phase Cycle's first iteration. A user cancelling the gate (no option picked) is treated as a pause: `Spec depth` remains `pending`, the orchestrator exits, and a later `/weave` re-runs the gate.

## Phase Cycle

```
1. Resolve project, read pipeline.md, and write the resolved project name to `.loom/.active` (single line, no trailing newline-only content). The PostToolUse telemetry hook reads this to attribute each dispatched subagent's transcript to the active phase (see "Telemetry hooks" below).
2. If pipeline.md.Lifecycle state == complete: report the lifecycle as done and exit.
3. Loop:
   a. Select the current phase.
   b. Dispatch the matching phase agent in a fresh Task session. The user-turn prompt is the two-band concatenation (stable head + dynamic tail) defined in `### Dispatch concatenation` below; the cached-prefix boundary contract in `## Conventions` is binding on every dispatch. Every phase, Build included, is one dispatch per phase entry; the Build agent runs its per-task work loop inline within that single session (see `phases/build/phase.md`).
   c. Surface the rerun-or-continue decision (see below) via AskUserQuestion. RETURN-block schema compliance is enforced by `hooks/validate-subagent-output.py` as a `SubagentStop` hook — malformed returns surface as visible hook blocks; the orchestrator does not run a parallel extractor.
   d. If the just-completed phase is Build: apply board transitions from the RETURN block's `task-outcomes` + `smoke` fields per `### Board transition mapping` below, then surface the rerun-or-continue gate. The transition application only runs when the just-completed phase is Build.
   e. On continue: update pipeline.md, advance phase, loop to (a). No
      live evaluation-row emit happens during the run; cost/usage figures
      are produced post-hoc by the telemetry harvester reading the session
      transcripts on disk after /weave finishes (see "Telemetry hooks" below).
   f. On rerun: re-dispatch the same phase agent with prior artifacts (+ optional Quality Check findings), loop to (b).
4. On Review continue: set Lifecycle state = complete, report and exit.
```

### Board transition mapping

Build no longer writes `board.md`; the orchestrator applies transitions from the RETURN block's `task-outcomes` + `smoke` fields after a Build return clears the SubagentStop hook.

| task-outcomes entry | smoke | Resulting column | Annotation |
| --- | --- | --- | --- |
| `status: green` | `passed: true` | `Done` | none |
| `status: green` | `passed: false` OR `ran: false` | `Review` | none |
| `status: failed` | any | `In Progress` | `[failed]` immediately after the ID |
| `status: hitl-block` | any | `Backlog` | `[HITL-blocked: <hitl-reason>]` immediately after the ID |
| Task IDs **not** in `task-outcomes` | any | unchanged | unchanged |

Tasks not mentioned in `task-outcomes` are untouched — this preserves partial Build runs cleanly. A RETURN block carrying `task-outcomes: []` together with `smoke.ran: false` is a valid (no-op) return: Build did no work this session and the orchestrator applies no transitions.

### Live mirror via hook

The orchestrator additionally runs a PostToolUse hook (`hooks/board-transition.py`) that applies the same mapping live during Build, driven by the per-task file writes Build performs:

- `tasks/T-NNN.test-log.txt` first write → card to `In Progress` (live mirror of "task started").
- `tasks/T-NNN.done.md` write → card transitioned per the table above using the `status:` field.
- `smoke-report.md` with no FAIL lines → all cards in `Review` promoted to `Done`.

The hook is best-effort. The orchestrator's end-of-Build reconciliation from the RETURN block (`task-outcomes` + `smoke`) remains authoritative — any drift between the hook-applied state and the RETURN block is corrected at end-of-Build. The hook exists solely so the Loom UI sees board.md mutate during a Build session instead of in one batch at the end.

The hook is idempotent: it does not rewrite `board.md` if the card is already in the target column with the correct annotation.

### Dispatch concatenation

Every Task dispatch — phase agent, quality-check agent, or any callable that follows the two-files-per-callable convention — is constructed as **two concatenated bands**: stable head, dynamic tail. This shape is what makes the cached prefix stable byte-for-byte across dispatches; see `## Conventions` for the boundary contract.

```text
<stable head: <role>.md body>
\n\n
---
\n\n
<stable head: <role>.signature.md>
\n\n
---
\n\n
<stable head: ## Inlined methods — content of every file the body's `## Reads` lists (band omitted entirely if `## Reads` is empty or absent)>
\n\n
<dynamic tail: <system-reminder> block>
```

Operationalised:

1. **Stable head — body + signature + inlined methods, verbatim, nothing else.**
   1. Read the body file (`phases/<phase>/phase.md` or `phases/<phase>/quality-check.md`).
   2. Append exactly two newlines, then `---` on its own line (a markdown thematic break), then two more newlines.
   3. Append the signature file's contents (`phases/<phase>/phase.signature.md`, etc.).
   4. **Inline the methods the body needs.** The inline set is every file listed in the body's `## Reads` (or `## Reads first`) section, resolved relative to the skill base. For each file in listed order, append two newlines, `---`, two newlines, then `## Inlined methods` (once, before the first), then `### <path-as-listed>` on its own line, then the file's verbatim content. A phase with an empty or absent `## Reads` (e.g. Design, Plan) skips this band entirely — no `## Inlined methods` block is appended. The subagent reads no method file from disk — it has the content inline. The orchestrator already reads these files the same way it reads the body, so this needs no path knowledge the orchestrator lacks and no filesystem access the subagent has.
   5. The body and signature carry their `<project>`, `<phase>`, `<task>` placeholder tokens **literally** — do NOT substitute real values into the head. The body is what makes the prefix cacheable across projects.
   6. The head is the entirety of the cacheable region — body, signature, and inlined methods are all stable per callable, so the whole head caches. The RETURN-block schema, what to write, what to skip, and now the method procedures themselves all live in the head. The orchestrator adds **no wrapper text** around them and **no path for the subagent to resolve**.
2. **Dynamic tail — single `<system-reminder>` block.** Append the substituted identifiers in exactly this shape, at the very end of the user turn:

   ```
   <system-reminder>
   Active project: <project>
   Active phase: <phase>
   Current task: <T-NNN | none>
   Date: <YYYY-MM-DD>
   </system-reminder>
   ```

   Nothing dynamic appears above the opening `<system-reminder>` line. The closing `</system-reminder>` is the cached-prefix boundary; the tail itself is not cached.
3. Pass the result as the user turn to a fresh `Task` session.

The order — body, `\n\n---\n\n`, signature, tail — is fixed. Body first establishes identity and primary work loop before the agent reads the wire contract. The `---` separator renders as a markdown thematic break (visible to a human reading the merged prompt) and is unambiguously parseable back out into its two halves.

If either `<role>.md` or `<role>.signature.md` is missing for a callable about to be dispatched, the orchestrator fails dispatch with a clear `missing-file: phases/<phase>/<role>.md|<role>.signature.md` error before any Task is started. There is no partial dispatch and no fallback to a default.

The merged prompt is the dispatched Task's user turn only. The orchestrator never inlines it into its own context — the Task-isolation property is preserved.

The orchestrator runs the lifecycle to completion in one `/weave` invocation. It does not exit between phases — the rerun-or-continue gate is a regular `AskUserQuestion`, not a session boundary. The orchestrator exits only when:

- `Lifecycle state` becomes `complete` (Review→done).
- The user cancels at a gate `AskUserQuestion` (treat as "pause"; `pipeline.md` is preserved and a later `/weave` resumes from the current phase).
- A hard failure occurs (malformed RETURN that the SubagentStop hook blocks, workspace unresolvable, etc.).

### Telemetry hooks

Only relevant if running with the evaluation harness. Loom's telemetry / eval substrate lives under `orchestrator/lib/telemetry/`:

- `tag-subagent-phase.py` — PostToolUse hook; tags each dispatched subagent's transcript with the active phase by reading `.loom/.active`.
- `transcript-harvest.py` — post-hoc walker; produces `usage.jsonl` from each session's `subagents/` directory.
- `eval-aggregate.py` — folds usage rows into `usage.md` per workspace.
- `retag-sidecars.py` — repair tool for retagging `.phase` sidecars after a phase change.
- `session-store.sh` — sourced by the SessionStart / Stop hooks (`auto-advance.sh`, `resume-on-start.sh`) to record session ownership.
- `artifacts.sh` — PostToolUse helper; rebuilds `.loom/<project>/artifacts.json` after Write/Edit/MultiEdit.

A packager producing a slim loom profile can `rm -rf orchestrator/lib/telemetry/` and every `/weave` operation that does not run analysis continues to function.

## Rerun-or-Continue Decision (Human-In-The-Loop)

Reruns are user-driven, never automatic. The lifecycle has **one** opt-in Quality Check, at the Plan→Build gate; it audits the full Spec + Design + Plan artifact set so the user can decide whether to launch the irreversible Build phase.

The gate summary leads with the phase's purpose — the first sentence of `phases/<phase>/phase.md` (e.g. "Clarify the seed into specified intent." for Spec, "Convert specified intent into solution structure." for Design). Read that line at gate time and prepend it so the user knows what the phase was responsible for.

**Spec, Design, Build** gates surface a two- or three-option `AskUserQuestion` (no QC option):

```
Phase <phase> returned (<phase purpose>). <one-line summary of produced artifacts>.

  Continue → <next-phase-verb>   accept the artifacts; advance to the next phase
  Rerun phase                    re-dispatch <phase> with prior artifacts as additional context
  Go back to <prior-phase>       re-open <prior-phase>; move current + downstream artifacts to `superseded/<timestamp>/` (shown for Design and Build; Spec is first — nothing to go back to)
```

**Plan** gate surfaces the four-option `AskUserQuestion` (QC + Go-back-to-Design + Rerun + Continue). This is the only gate where Quality Check is offered:

```
Phase plan returned (convert solution structure into an executable work graph). <one-line summary>.

  Continue → start autonomous Build (modifies repository)   accept and launch Build
  Run quality check                                         dispatch the Pre-Build Quality Check agent
                                                            (audits Spec + Design + Plan together)
  Rerun phase                                               re-dispatch Plan with prior artifacts
  Go back to Design                                         re-open Design; move Plan artifacts to `superseded/<timestamp>/`
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

### When the user picks `Run quality check` (Plan gate only)

1. Dispatch the Pre-Build Quality Check agent (`phases/plan/quality-check.md` + `phases/plan/quality-check.signature.md`) against the full pre-Build artifact set (Spec + Design + Plan), using the same body+signature concatenation rule.
2. The agent writes `quality-review.md` covering findings across all three phases and updates `pipeline.md` "Quality findings".
3. Surface the findings preview in chat and re-ask:

   ```
   Pre-Build Quality Check findings:
   <preview of holes, blind spots, contradictions, missing assumptions across Spec / Design / Plan>

     Continue → start autonomous Build  accept the findings as known; advance
     Rerun Plan                         re-dispatch Plan with prior artifacts + the findings as additional context
     Go back to Design                  re-open Design with the findings as additional context
     Go back to Spec                    re-open Spec with the findings as additional context
   ```

   The Go-back options exist because findings frequently point at upstream phases (e.g. a Spec story with no realisation in Design); the user picks the phase the finding actually owns.

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
