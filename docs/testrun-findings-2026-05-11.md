# Loom test-run findings — 2026-05-11

End-to-end run of `/weave` on a small webapp seed (`pomodoro-timer`,
single-file static HTML). Goal was to surface friction points and cleanup
candidates in the framework, not to validate a real project.

## Caveat: the test partially missed the framework's interaction surface

The driver (Claude) misread the prompt and forced the run into a synthetic
"autonomous" mode by (a) putting a `do not call AskUserQuestion` operator
note in the seed, and (b) repeating that instruction in each phase
dispatch prompt. The consequences for this test run:

- Idea did not grill — every `decisions.md` slot was auto-resolved from
  the seed and marked `Status: answered (auto-resolved from seed)`.
- No Quality Check was offered or run for any phase.
- The Continue/Rerun gate after each phase was bypassed (the driver
  picked Continue inline rather than surfacing the `AskUserQuestion`).
- Build dispatched a single coordinator subagent that did everything
  in one atomic write rather than spawning a fresh `task-builder` per
  task.

So most "interaction" observations from this run are invalid as
framework critiques — they describe a hacked-up bypass, not the
framework's intended path. The findings below are scoped to **real
framework issues that survive a corrected run**: stale paths, missing
hard rules, leftover artifacts, parser ergonomics. No scope-expanding
proposals (no new "interaction mode" field, no gate restructuring) —
the framework's HITL/AFK boundary at Plan→Build stays as designed.

---

## F-1 — `artifacts.json` is a leftover and should be removed

### Issue
`pipeline-parser.py init` writes an empty
`.loom/<project>/artifacts.json`. No phase agent updates it through the
lifecycle. Post-run inspection shows the file frozen at the
init-time state (`schema-version: 1, artifacts: []` or whatever was
hand-written by the orchestrator), while `pipeline.md.Produced
artifacts` carries the real, current list.

Evidence: [test/.loom/pomodoro-timer/artifacts.json](../test/.loom/pomodoro-timer/artifacts.json) lists 3 entries;
[pipeline.md](../test/.loom/pomodoro-timer/pipeline.md) `Produced artifacts` lists 14.

Two sources of truth that drift on every phase boundary.

### Options
- **(a) Drop `artifacts.json`.** Remove the write in
  `pipeline-parser.py` `init_workspace`, remove the file from the
  contract in `weave/contract.md`, and let `pipeline.md` be the single
  artifact source of truth.
- **(b) Wire every phase agent's RETURN to update `artifacts.json`.**
  More work, no obvious payoff over (a) since `pipeline.md` already
  carries the same list in human-readable form.

### Recommendation
**(a)** — clean delete. `pipeline.md` is already canonical and is the
file every phase agent updates. Three locations to touch:
[orchestrator/lib/pipeline-parser.py](../orchestrator/lib/pipeline-parser.py)
(`init_workspace`), [orchestrator/weave/contract.md](../orchestrator/weave/contract.md)
(the Outputs table row), and [orchestrator/weave/methods/create-project.md](../orchestrator/weave/methods/create-project.md)
(step 3).

### Your answer
<!-- fill in -->


---

## F-2 — Stale `loom/log/…` path references after the `orchestrator/` refactor

### Issue
The orchestrator was moved under `orchestrator/` (so the log dir is
`orchestrator/log/`), but several phase agent specs still reference the
pre-refactor path `loom/log/…`. The Review agent in the test run
discovered this empirically: it tried to write to `loom/log/audit.md`,
that path didn't exist, and it fell back to `orchestrator/log/audit.md`
(noted in [develop-log.md](../test/.loom/pomodoro-timer/develop-log.md)).

Affected references (grep `loom/log/`):

- [orchestrator/weave/phases/review/agent.md:22](../orchestrator/weave/phases/review/agent.md#L22)
- [orchestrator/weave/phases/build/agent.md:27](../orchestrator/weave/phases/build/agent.md#L27)
- [orchestrator/weave/phases/build/contract.md:41-42](../orchestrator/weave/phases/build/contract.md#L41-L42)
- [orchestrator/weave/phases/build/methods/task-builder.md:20,29,52](../orchestrator/weave/phases/build/methods/task-builder.md#L20)
- [orchestrator/weave/phases/build/methods/smoke-test.md:17](../orchestrator/weave/phases/build/methods/smoke-test.md#L17)
- [orchestrator/weave/phases/build/methods/mutation-test.md:17](../orchestrator/weave/phases/build/methods/mutation-test.md#L17)

### Options
- **(a) Search-and-replace** `loom/log/` → `loom/orchestrator/log/` (or
  the relative path each spec actually needs given its dispatch
  context). Pure docs fix.
- **(b) Re-introduce a `loom/log/` symlink** to `orchestrator/log/`.
  Keeps the docs unchanged. Adds a layer of indirection that future
  readers will hit.

### Recommendation
**(a)** — fix the references. They're stale, not contractual. The path
phase agents read should match where the file actually is.

### Your answer
<!-- fill in -->


---

## F-3 — `pipeline-parser.py init` clobbers a non-empty `seed.md`

### Issue
During bootstrap, I wrote the seed content first and then ran
`pipeline-parser.py init …` again (recovering from a misplaced earlier
init). The second `init` overwrote `seed.md` with an empty default,
silently destroying the content I'd written.

Source: [pipeline-parser.py:218-221](../orchestrator/lib/pipeline-parser.py#L218-L221):

```python
def init_workspace(project_dir: Path, project: str, seed: str, ticket: str, type_hint: str) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(project_dir / "pipeline.md", initial_pipeline(project, ticket, type_hint))
    atomic_write(project_dir / "seed.md", seed.rstrip() + "\n")
```

`pipeline.md`'s init is idempotent-ish (re-init resets state, which is
arguably the intended behavior). `seed.md` is **user-authored content**
and should never be overwritten by an idempotent setup step.

### Options
- **(a) Refuse to overwrite a non-empty `seed.md`.** If
  `seed.md` exists and is non-empty, skip the write and emit a
  one-line warning to stderr. Hard fail if `--seed` was passed with
  conflicting content.
- **(b) Refuse to re-init at all if `pipeline.md` exists.** Stronger
  but more annoying — would require a `--force` flag for recovery
  scenarios.
- **(c) Always require an explicit `--force-seed` flag to overwrite.**
  Equivalent to (a) plus an escape hatch.

### Recommendation
**(a)** — the principle is "don't destroy user content silently."
`pipeline.md` being re-initted is recoverable (it's framework state);
`seed.md` is not.

### Your answer
<!-- fill in -->


---

## F-4 — `pipeline-parser.py init` argument semantics are easy to misread

### Issue
The CLI is `init <project_dir> <project>`. `project_dir` is the
**workspace directory itself** (e.g. `.loom/pomodoro-timer`), not the
parent directory containing workspaces. I read it as the latter and
ran `init . pomodoro-timer`, which wrote `pipeline.md` and `seed.md`
directly into the cwd instead of into `./pomodoro-timer/`.

Source: [pipeline-parser.py:266-270](../orchestrator/lib/pipeline-parser.py#L266-L270).

This is a documentation/naming issue, not a code bug — the function
itself is consistent. But the arg name and `methods/create-project.md`
phrasing ("Create `.loom/<project>/` from a seed") disagree on whether
the caller passes the parent or the workspace path.

### Options
- **(a) Rename the arg.** `project_dir` → `workspace_dir` (or
  `project_root`). Clarifies that it's the destination, not a parent.
- **(b) Change the semantics** so it takes `parent_dir` and joins with
  the project name. Breaking change for any external callers
  (`weave/SKILL.md` etc.).
- **(c) Add a usage example** to the CLI `--help` showing
  `init .loom/<project> <project>`. Cheapest fix.

### Recommendation
**(c) + (a)** — keep the function shape, rename the arg, and add the
usage example to `--help`. Combined cost is one commit, no caller
breakage.

### Your answer
<!-- fill in -->


---

## F-5 — Quality Check scoping is hardcoded to Idea, not predicated on validator presence

### Issue
[weave/SKILL.md:64](../orchestrator/weave/SKILL.md#L64) says
"For phases that support Quality Check (currently **Idea** only)…"
and [weave/SKILL.md:26](../orchestrator/weave/SKILL.md#L26) only loads
`phases/idea/validator.md`. Adding a validator for Design or Plan would
require also editing `SKILL.md` to flip the branch. There's a real
[docs/weave/phase-validators.md](weave/phase-validators.md) document
that may already be drafting more validators, but the orchestrator
doesn't pick them up dynamically.

Same hardcoding in [weave/contract.md:20](../orchestrator/weave/contract.md#L20):
"opt-in only | Loaded when user picks Run quality check (currently Idea
phase only)".

### Options
- **(a) Predicate QC on validator file presence.** The orchestrator
  checks `phases/<phase>/validator.md` existence at dispatch time. If
  present, surface the 3-option `AskUserQuestion` (Continue / Run
  quality check / Rerun phase). If absent, surface the 2-option
  prompt. No code change needed when a new validator is added — just
  drop the file in place.
- **(b) Maintain an explicit list** of phases-with-QC in `SKILL.md` and
  update it each time a validator is added. Status quo plus
  bookkeeping.

### Recommendation
**(a)** — file-presence is the predicate that the framework actually
cares about. It also matches the existing
[methods/find-project.md](../orchestrator/weave/methods/find-project.md)
pattern of "look for files; absence is a decision."

### Your answer
<!-- fill in -->


---

## F-6 — Build coordinator can implement tasks inline instead of dispatching `task-builder` per task

### Issue
[build/agent.md:33](../orchestrator/weave/phases/build/agent.md#L33)
says *"Dispatch `methods/task-builder.md` one task at a time unless a
declared parallel batch has disjoint file scope."* That wording is
descriptive, not prescriptive — a coordinator can read it and decide to
implement the file itself rather than spawn subagents per task. That's
what happened in the test run: one coordinator wrote
`build/index.html` in a single atomic write across all 7 tasks. The
`tasks/T-NNN.done.md` reports were back-filled to cite which lines
satisfied which AC, but the per-task fresh-context contract was
violated.

This matters because the framework's vertical-slice design only pays
off if each slice runs in its own fresh context — that's the whole
point of slicing in Plan. Letting Build collapse the DAG defeats it.

[task-builder.md:3](../orchestrator/weave/phases/build/methods/task-builder.md#L3)
already says "Implement one task from `tasks/T-*.md` in a fresh
context." The task-builder spec is correct; the coordinator-side
contract is loose.

### Options
- **(a) Tighten the wording in `build/agent.md`.** Replace step 3 with
  a hard MUST: "For each ready task, dispatch a fresh `Task` subagent
  running `methods/task-builder.md`. The coordinator MUST NOT
  implement task scope itself; that is exclusively the task-builder's
  responsibility. The coordinator's only outputs are board mutations,
  the test report, and the develop log."
- **(b) Add a verifier:** after Build returns, the orchestrator
  asserts that each `tasks/T-NNN.done.md` was written by a different
  subagent context (e.g. by checking a `dispatched-by` field the
  task-builder writes into the done report). Stronger but adds state.
- **(c) Both.** Hard wording in the spec, plus a `dispatched-by` field
  that audits can read.

### Recommendation
**(a) for v1**, with (c) as a follow-up if you observe further
single-write deviations. The spec wording is the cheapest backstop;
the field is auditability.

### Your answer
<!-- fill in -->


---

## F-7 — Lifecycle-done has no canonical representation

### Issue
After Review returns `complete`, the project's lifecycle is done — but
there's no clean way to encode that in `pipeline.md`. The current
convention is `Current phase = review, Phase status = complete`, which
is workable but conflates "Review phase is done" with "the whole
lifecycle is done." A reader can't tell the difference without
inspecting History.

I initially proposed adding `complete` to `VALID_PHASES`; you correctly
flagged that "complete" isn't a phase, so that mixes concerns.

### Options
- **(a) Pure convention.** Document in
  [weave/SKILL.md](../orchestrator/weave/SKILL.md) under "Completion"
  that `Current phase = review` AND `Phase status = complete` is the
  lifecycle-done marker. No code change. The downside is that the
  marker is implicit and shares a slot with normal phase state.
- **(b) Dedicated section** in `pipeline.md`:
  ```
  ## Lifecycle state
  ```text
  active
  ```
  ```
  Values `active | complete`. Parsed via the existing fenced-field
  mechanism. Phase agents don't need to touch it; only the
  orchestrator does, on the Review→done transition. Future-proofs for
  values like `halted` / `abandoned` without polluting the phase
  enum.
- **(c) Both.** Pick the explicit field, *and* update the docs.

### Recommendation
**(b)** — small, additive, clean. The marker becomes greppable and
readable in `pipeline.md`. One field added to `SECTION_ORDER` and
`FENCED_FIELDS` in [pipeline-parser.py](../orchestrator/lib/pipeline-parser.py),
one new `VALID_LIFECYCLE_STATES = {"active", "complete"}` constant,
plus the SKILL.md doc edit.

### Your answer
<!-- fill in -->


---

## F-8 — Plan does not declare the verification environment, so Build can silently downgrade

### Issue
In the test run, [tests.md](../test/.loom/pomodoro-timer/tests.md)
specified the acceptance checklist as "open `build/index.html` in
current desktop Chrome and Firefox via `file://`." Build had no GUI
browser, invented a Node-stubbed simulator, ran the checklist there,
and returned green. Review (correctly) caught this and filed Major
finding M-1.

The framework's blind spot: Plan declares *what* to verify but not
*where*. Build is left to interpret "Chrome and Firefox" by best
effort, and a capability gap goes undetected until Review. For an
autonomous-run profile this is a real risk; for an interactive run
the user would notice during the Plan gate.

### Options
- **(a) Add a `Verification environment` section** to `plan.md` as a
  required field. Values are short, e.g. `manual-browser-desktop`,
  `headless-playwright`, `node-stub`, `manual-cli`, `cli-test-suite`.
  Build reads it and refuses to mark gates green if its actual
  execution environment doesn't match. Review reads it as part of
  audit.
- **(b) Add the field to task-level frontmatter** instead — each task
  can have its own `verification-environment`. More granular but more
  bookkeeping; for most projects a single declaration at plan level
  is enough.
- **(c) Do nothing.** Rely on Review to catch downgrades after the
  fact. Costs a Major finding per occurrence; depends on Review
  being thorough.

### Recommendation
**(a)** — single plan-level field, with the option to override at
task level later if needed. The declaration is small, the contract is
explicit, and Build gets a hard signal to stop instead of inventing
a path forward silently.

### Your answer
<!-- fill in -->


---

## Out of scope (explicitly dropped)

These were in my earlier draft but the user-driver correction puts them
out of scope for cleanup work. Listed here so they don't get
rediscovered later as "missing":

- **"Interaction mode" pipeline field** (autonomous vs interactive).
  The framework has a clear HITL/AFK boundary at Plan→Build by design;
  adding a mode field would muddy that.
- **Gate consolidation across phase transitions.** The Continue / Run
  quality check / Rerun gate is load-bearing: QC has fresh context and
  the user uses its findings to decide rerun. The gate is not a UX
  no-op; the original framework design is correct.
- **"Single-shot build" carve-out** for single-file deliverables. The
  framework's intent is per-task fresh context for every task; a
  carve-out would defeat the slicing rationale. F-6 is the correct
  fix.
