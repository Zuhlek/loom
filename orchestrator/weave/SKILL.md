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
4. Read `phases/<phase>/quality-check.md` + `phases/<phase>/quality-check.signature.md` (available for `spec`, `design`, `plan`, `build`) only when the user opts into a quality check before deciding on a rerun. Review has no `quality-check.md` because Review is itself the project-level quality check.

The RETURN schema is the fenced `yaml` block under `### Return block` inside `phase.signature.md` / `quality-check.signature.md`. Phase RETURN-block schema is enforced solely by `hooks/validate-subagent-output.py`; failures surface as visible hook blocks rather than silent re-dispatch.

The `--answers` flag is no longer accepted by `/weave`; the eval harness stages `.answers.yaml` directly under `.loom/<project>/` before invoking `/weave`. Unknown flags are silently ignored. The Spec grilling agent's existing read-if-present behaviour on `.loom/<project>/.answers.yaml` is preserved, so a harness-staged file is consumed as before.

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

## Repo pre-flight

Runs on every `/weave` entry before the Phase Cycle. Validates the shared repo digest cache and, on miss, dispatches a single `Explore` Task that produces all three pre-flight artifacts. The cache files themselves are the only persistence layer.

Procedure (procedure-ordered list — preserve step order on any future edit):

1. Read `.loom/.cache/repo-digest.manifest.json`. Treat absent file or JSON parse error as a cache miss.
2. Run `git rev-parse HEAD` to capture the current repo head. A non-zero exit fails pre-flight with a clear `git-rev-parse-failed` error before any Task is started; the orchestrator does not enter the Phase Cycle.
3. Evaluate the cache-valid predicate. The cache is valid when ALL of the following hold:
   - `manifest.schema_version == 1`.
   - `manifest.git_head` equals the captured `git rev-parse HEAD`.
   - For every `(path, sha256)` pair in `manifest.tracked_files`: the file exists on disk AND its current sha256 equals the recorded sha256. A missing tracked file is drift, not a hit.
4. Branch on the predicate:
   - **Full match → skip Explore.** Proceed directly to the Phase Cycle. The cached digest is trusted verbatim.
   - **Any mismatch → dispatch a single `Explore` Task.** One Task call, one briefing covering both the cross-fabric digest and the per-project context, scoped per the **Briefing scope** below. The briefing requires the Task to produce all three artifacts in the same run:
     - `.loom/.cache/repo-digest.md`
     - `.loom/.cache/repo-digest.manifest.json`
     - `.loom/<project>/repo-context.md`
5. After the Task returns, verify each of the three artifact paths exists. A missing artifact fails pre-flight with a clear error naming the absent path; the orchestrator does not enter the Phase Cycle.
6. Proceed to the Phase Cycle.

Failure modes:

| Failure | Detection | Handling |
| --- | --- | --- |
| Manifest JSON malformed | Parse error during step 1 | Treat as cache miss; dispatch full Explore (overwrites manifest). |
| `git rev-parse HEAD` fails | Non-zero exit in step 2 | Fail pre-flight before any Task is started. |
| Tracked file missing on disk | Read fails during step 3's sha256 recomputation | Treat as drift; full Explore rebuild. |
| Explore Task returns without all three artifacts | Step 5 artifact check | Fail pre-flight with the missing artifact path; do not enter Phase Cycle. |

The pre-flight signal IS the cache. Every `/weave` entry re-evaluates the predicate; in steady state the work is two file reads plus one `git rev-parse`.

### Briefing scope

The digest captures productive program code only — the stack, topology, chokepoints, and conventions a fabric run would re-derive. The Explore Task briefing MUST pin the following so the pass stays bounded and never analyzes the orchestrator's own workspace:

- **Enumerate the file universe with `git ls-files`, then drop every path under `.loom/`.** `git ls-files` already excludes `.gitignore`'d output (build artifacts, `node_modules`, etc.); the explicit `.loom/` filter removes the orchestrator's workspace — its project artifacts, caches, and prior digests are NOT productive code and must never enter the digest or the manifest's `tracked_files`. Treat the resulting list as the only files in scope; do not read, cite, or sha256 anything outside it.
- **Breadth `medium`, not exhaustive.** The goal is the architectural skeleton, not a file-by-file census. Sample representative files per area; stop once the stack, topology, and "where X lives" are answerable. Do not open every file in a large directory to confirm a pattern already established by the first few.
- **The manifest cites only what the digest actually relies on.** `tracked_files` holds the sha256 of each file a digest section is derived from — a small, load-bearing set — not the whole `git ls-files` output.

These constraints are why a first pass should cost tens of tool uses, not hundreds: an unbounded free-roam over the full tree (including `.loom/`) is the failure this section exists to prevent.

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
