# Lifecycle Concepts — Forge vs. Loom Matrix

Scope: phase agents + their methods. Excludes orchestrator wiring, explore-prototype, hooks, logging.

Forge had two lifecycle skills (`idea`, `build`) plus the meta `forge` skill. Loom expands `idea` into **Spec / Design / Plan**, adds a dedicated **Review** phase, and keeps **Build**. Forge concepts are mapped onto the loom phase where the equivalent (or evolved) concept now lives.

Legend: ✓ present · — absent · ↑ present but materially evolved/formalized in loom

---

# Discussion — Why the New Concepts

Framing for the decision: each section names the abstract concept, what it does, what it buys, and how it differs from how forge handled (or didn't handle) the same surface.

## 1. Why a dedicated Plan phase?

**What it does.** Plan is the phase that converts solution structure into an *executable work graph*: vertical task slices with stable IDs, a `blocked-by` DAG, story-coverage check, test sketches derived from EARS, autonomy classification (AFK / HITL), and a declared verification-environment harness. Plan's output is what Build *executes*, not what Build *interprets*.

**What it buys.**

- **Pre-flight failure detection.** Cycles, missing story coverage, dangling `blocked-by` edges, harness mismatches — all caught before a single line of code is written. Build can refuse to start when the declared environment isn't runnable, rather than silently substituting.
- **Autonomy budget made explicit.** Tasks are tagged `AFK` (Build runs solo) or `HITL` (requires human). The autonomy contract is visible at plan-time, not discovered mid-build when an agent stalls.
- **Coordinator stays dumb.** Because the graph is declared up front, the Build coordinator's only job is "pick ready cards, dispatch, transition columns." It doesn't decide *what* to build next — the DAG does.
- **Traceability spine.** Every `T-NNN` references the `US-NNN` stories it satisfies. Review walks story → tasks → diff with a structured path; nothing is implicit.

**Vs. forge.** Forge had no plan phase as such — `task.md` and `tests.md` were generated at the tail of `idea` and immediately consumed by `build`. Dependencies were a free-form `Depends on:` field; parallelism was a `## Parallelization` paragraph the user wrote in prose. No graph validation, no story coverage (no stories), no harness contract. The autonomy question — "can the agent run this alone?" — wasn't asked; build just tried and either worked or didn't.

---

## 2. Why split Spec from Design?

**What changes.** Spec owns *WHAT and WHY*: user intent, scope, user stories with EARS acceptance criteria, constraints. Design owns *HOW*: components, interfaces, data shape, state, ADRs about structure. Design treats `spec.md` as read-only — contradictions are routed back as Spec open-ambiguity, not patched in-place.

**What it buys.**

- **Different question shapes don't compete.** Spec questions are about value and scope (Y/N, Choice, Background dominate). Design questions are structural and need diagrams (Architecture dominates). Mixing them biases the agent toward whichever shape it asked first; separating them lets each category run at full density.
- **Independently auditable axes.** Review can ask "did we build the right thing?" (Spec) and "did we build it the right way?" (Design) as separate questions, with separate evidence. A failed test points to a story (Spec) AND to a structural decision (Design); collapsed into one artifact, that distinction is gone.
- **Bounded rerun cost.** A structural defect can re-burn Design tokens without re-burning Spec. Forge's all-in-one `idea` meant any rework reopened the entire surface.
- **Read-only contract prevents quiet scope creep.** A design choice that *requires* changing user-facing behaviour has to walk back through Spec — making the change explicit, decisions-recorded, and visible at the next gate.

**Vs. forge.** Forge collapsed both into `idea`. `plan.md` carried Goal + Approach + Design & Architecture Decisions + Open Questions in one file; mockups were a separate phase but their feedback flowed back into the same artifact. The "what changed and why" trail was a single linear edit history.

---

## 3. Why a Review phase?

**What it does.** Review is a dedicated audit pass after Build, with its own agent in a fresh context. It walks intent satisfaction, design conformance, plan completion, test evidence, code quality, principle compliance (P1–P7), and safety — emitting findings with structured shape (severity, evidence, expected, actual, impact, recommendation, owner-phase).

**What it buys.**

- **Closes the loop.** Smoke verifies the code runs; tests verify behaviour against assertions; neither verifies that the *body of work* matches the contracts (Spec stories, Design ADRs, Plan scope). Review is the only phase whose job is "do the outputs match the inputs."
- **Severity calibration.** Build can return `green` / `failed` / `hitl-block` — that's it. It cannot say "this works but the abstraction violates P5." Review introduces Blocker / Major / Minor / Note so non-blocking concerns are captured without stalling the lifecycle.
- **Fresh context = independent reader.** The Build coordinator is anchored in "I just made this work, the tests pass." Review starts from "does this match what was promised?" without that anchoring bias. Same reason code review is done by someone other than the author.
- **Structured findings are reusable artifacts.** A Review finding has evidence + expected + actual + impact + recommendation + owner-phase. Forge's wrap-up produced prose summaries; Review produces machine-walkable records that feed both go-back decisions and process learning.
- **Process-learning capture in-flow.** Review explicitly records what to feed back. Forge's `/forge insights` was post-hoc transcript mining — useful, but reactive. Review is preventive.

**Vs. forge.** Forge ended at `.build-phase = built`. The wrap-up sub-phase ran smoke + integration tests + optional mutation, then asked the user for feedback. There was no audit against original intent, no principle walk, no severity-graded finding stream. Drift between what was specified and what was built was only ever caught by the user noticing later.

---

## 4. Why vertical slicing + per-task subagents in Build?

**The concept.** Plan slices work *vertically* — each task is a thin end-to-end slice of one or more stories' acceptance criteria, not a horizontal layer (e.g. "all migrations"). Build dispatches each task to a *fresh subagent context*, while the Coordinator only mutates the board and aggregates.

**What it buys, abstractly.**

- **Linear context budget.** Fresh context per task means each subagent sees only its own scope, not the cumulative debris of every prior task. Token cost grows with task count, not with task-count squared. A 30-task build stays tractable.
- **Failure isolation.** A subagent that exhausts its three-attempt cap marks one card `[failed]` and exits. The Coordinator's context is never polluted with debugger output, stack traces, or red herrings from the failed attempt. The next task starts clean.
- **Implementation / dispatch separation kills scope drift.** The Coordinator *cannot* implement — it only has Bash + atomic-write tools for board mutation. This structurally rules out "the agent did extra stuff while routing." Every implementation edit is owned by a subagent whose declared scope is in `tasks/T-NNN.md`.
- **Parallelism is a property of the graph, not a prose plan.** Any subset of `Backlog` cards with empty `blocked-by` and disjoint file scope is dispatchable concurrently. The DAG *is* the parallelization plan — no human-curated `## Parallelization` paragraph to drift from reality.
- **Each green slice is demoable.** A vertical slice → green → working end-to-end behaviour. Horizontal slicing (all DB, then all API, then all UI) means nothing is valuable until the last layer lands; partial failure leaves a half-built stack. Vertical means partial = some stories work, others not yet.
- **Review can audit mid-flow.** Because each completed slice satisfies named stories, Review (or a quality check) can audit progress at any waypoint without "but it doesn't run yet" being a valid answer.
- **Structurally detectable bad slicing.** Plan's quality check flags horizontal tasks ("all DB migrations"). The slicing discipline isn't a style preference; it's enforced by the story-coverage invariant — a task that doesn't satisfy a story has no reason to exist.

**Vs. forge.** Forge launched parallel tasks via subagents too, but from the *same* coordinator context — every subagent inherited the Coordinator's accumulated state. Tasks were declared in a single `task.md` block, sliced however the planning step happened to slice them, with no story-coverage check and no "vertical" discipline. Failures landed in the shared context; rerunning meant Coordinator state was already biased.

---

# Matrix — Concept Presence
Below: phase-by-phase matrix of which abstract concepts existed in forge vs. loom, and which were materially evolved.

## Spec (loom) ↔ Idea/front (forge)

| Concept | Forge | Loom |
|---|---|---|
| Codebase exploration before planning | ✓ (informal "explore the codebase") | ↑ formal **repository pre-flight** (`repo-context.md` via Explore subagent) |
| Opinionated questioning (recommendation-first) | ✓ (`**Recommendation:**` in `questions.md`) | ↑ enforced as G4 of six-criteria self-check |
| Structured question discipline | — (free-form Q1/Q2 markdown) | **Grilling** rules (six G-criteria, self-check, regen-on-fail) |
| Problem-space / solution-space staging | — | **Foundation → Branching** (Double Diamond) |
| Category demotion (Y/N > Choice > Architecture > Background > Open) | — | ✓ cheapest-viable category triage |
| Briefing block (issue / cause / options / rec / why-not) | — (only title + recommendation + answer slot) | ✓ mandatory briefing wrapper, word caps, plain-text discipline |
| Push-back / Stop as first-class answers | — (file-edit only) | ✓ first-class picker actions + slot grammar |
| Live interactive answering | — (edit `questions.md`, re-run `/idea`) | ↑ `AskUserQuestion` in-loop, slot-mirrored |
| Stable question IDs across reruns | — (Q1/Q2 rewritten each iteration) | ✓ `Q-NNN` IDs, status taxonomy, audit trail |
| Revisit / consistency pass when answers conflict | — | ✓ flip-only trigger, supersede-by chain |
| User stories with EARS acceptance criteria | — (no story layer) | ✓ `US-NNN` distillation, normative `SHALL` clauses |
| Constraints vs. stories separation | — | ✓ envelope invariants vs. user-shaped behaviour |
| Triage track (quick / standard / deep) | ✓ complexity-aware path selection | — (per-phase HITL gate replaces it) |
| Mockup phase (UI / API / architecture) | ✓ dedicated phase, `mockup-review` state | ↑ folded into Design as **evidence-on-demand** |
| Project-type system with inheritance | ✓ `~/.claude/skills/types/<type>.md` + `Extends:` | — (dropped) |
| Ticket-ID convention | ✓ `CSD-789` prefix on project dir | ✓ retained at workspace level |

---

## Design (loom) ↔ Idea/back-half (forge)

| Concept | Forge | Loom |
|---|---|---|
| ADR-shaped decisions (Context / Decision / Rationale / Alternatives) | ✓ `## Design & Architecture Decisions` in `plan.md` | ↑ promoted to dedicated `Architecture decisions` section in `design.md` |
| WHAT / HOW separation (no flow restating) | — (plan mixed concerns) | ✓ spec is read-only; design specifies structure only |
| Structure-first artifact (components / interfaces / data / state) | — (collapsed into `plan.md`) | ✓ dedicated required sections |
| Explicit alternatives-rejected surface | partial (inside ADR block) | ✓ ADR-internal + design-level `Alternatives considered` |
| Mockup as evidence | ✓ standalone phase | ↑ on-demand only when resolves structural ambiguity |

---

## Plan (loom) ↔ Idea/tasks (forge)

| Concept | Forge | Loom |
|---|---|---|
| Self-contained tasks (Do / Files / Depends / Tests / Done-when) | ✓ `task.md` flat block | ↑ `tasks/T-NNN.md` per file with required frontmatter |
| Task dependencies | ✓ `Depends on:` free-form list | ↑ **`blocked-by` DAG** with acyclic invariant |
| Parallelization declaration | ✓ explicit `## Parallelization` section | ↑ implicit from DAG + disjoint file scope |
| Stable task IDs | partial (Task 1, 2 in `task.md`) | ✓ `T-NNN`, preserved across reruns |
| Story-to-task traceability | — (no stories existed) | ✓ `satisfies-stories: [US-NNN]`, coverage invariant |
| Tests-at-plan-time, runnable-against-stubs | ✓ `tests.md` with task + integration tables | ✓ retained as **test sketches** derived from EARS |
| Autonomy classification on tasks | — | ✓ **AFK / HITL** tagging |
| Mutation-testing opt-in flag | ✓ `**Mutation Testing:** yes/no` in `plan.md` | ✓ retained, moved to `tests.md` header |
| Verification-environment contract | — (implicit) | ✓ declared harness, Build pre-flight gates on it |
| Kanban board with column states | — (no board) | ✓ four-column parser-invariant board (`Backlog/In Progress/Review/Done`) |
| Ticket suggestion output | ✓ `ticket.md` artifact | — (dropped) |

---

## Build (loom) ↔ Build (forge)

| Concept | Forge | Loom |
|---|---|---|
| TDD contract (Red → Implement → Green) | ✓ enforced per task | ↑ extended to **Lock → Red → Implement → Green → Done** |
| Red = runtime assertion failure (not compile) | ✓ explicit rule | ✓ retained |
| Stub-first discipline (tests compile against stubs) | ✓ | ✓ retained |
| Fix implementation, never weaken tests | ✓ | ✓ retained |
| Parallel task execution | ✓ via Task subagents in same context | ↑ **Coordinator / Worker split**, per-task fresh context |
| Per-task fresh-context isolation | — | ✓ Coordinator dispatches, never implements |
| Scope-bounded edits (declared file scope) | partial (`Files:` field) | ✓ enforced; out-of-scope edits logged in `done.md` |
| Three-attempt cap (fail-stop) | — | ✓ hard limit on green retries |
| Status taxonomy on task return | partial (pass/fail) | ✓ `green / failed / hitl-block` |
| Concurrency primitives (project + per-task locks) | — | ✓ explicit `locks.sh acquire/release` |
| Atomic writes for shared artifacts | — | ✓ `atomic-write.sh` on every board mutation |
| Checkpoint logging after each task | ✓ `develop-log.md` append | ✓ retained (dual-write to `build.md`) |
| Smoke test (build artifacts / start / endpoints / visual / state integrity) | ✓ in wrap-up | ✓ retained as `methods/smoke.md` |
| Mutation testing (kill / survive / unkillable) | ✓ git-stash loop | ✓ retained as `methods/mutation.md` |
| Test-report aggregation | ✓ `test-report.md` per task + integration + smoke | ✓ retained |
| Tail-sized output discipline | — | ✓ explicit pipe-through-tail rule |
| Pre-flight (harness vs. declared env) | — | ✓ Build refuses silent substitution |
| No commits / pushes / destructive ops unless asked | ✓ | ✓ retained |
| Wrap-up as a distinct sub-phase | ✓ `.build-phase = wrap-up` | — (folded into Review) |

---

## Review (loom) ↔ — (forge had no dedicated review phase)

| Concept | Forge | Loom |
|---|---|---|
| Multi-axis audit (intent / design / plan / evidence / quality / safety) | — | ✓ dedicated Review phase |
| Principle-compliance walk (P1–P7) | — | ✓ checklist against diff |
| Severity calibration (Blocker / Major / Minor / Note) | — | ✓ explicit mapping |
| Structured finding shape (evidence / expected / actual / impact / recommendation / owner) | — | ✓ enforced |
| Process-learning capture | partial (`develop-log.md` only) | ✓ first-class Review target |
| Project-level final gate | — (build ended at `built`) | ✓ Review + `Lifecycle state = complete` |

---

## Cross-Phase / Orchestrator-Level

| Concept | Forge | Loom |
|---|---|---|
| Phase state on disk | ✓ `.phase` / `.build-phase` (one word) | ↑ canonical `pipeline.md` with structured sections |
| Phase-boundary HITL gate (rerun / continue) | — (skills ran straight through) | ✓ explicit `AskUserQuestion` after each phase |
| Opt-in quality check ("is rerun worth the burn?") | — | ✓ per-phase QC subagent |
| Go-back-to-prior-phase | partial (`Approach invalidation` reset rule) | ↑ formal, with **supersede-not-delete** of downstream artifacts |
| Stable cross-phase IDs (US / Q / T) | — | ✓ traceability spine |
| Read-only upstream artifacts | partial (plan mutable in place) | ✓ each phase owns its artifact; immutable absent go-back |
| Parser-invariant artifacts (HTML-comment markers) | — | ✓ `loom:question`, `loom:answer-slot`, `loom:story` markers |
| Per-phase signature / RETURN schema contract | — | ✓ `phase.signature.md` + silent schema-compliance redispatch |
| Self-reflection logging after each phase | ✓ `develop-log.md` mandatory append | ✓ retained (now under `tune`) |
| Curated learning loop (feedback → review → SKILL edits) | ✓ `/forge review` gatekeeper | ✓ retained as `/tune` |
| Plans mutable in place ("no plan-v2") | ✓ | ✓ retained |
