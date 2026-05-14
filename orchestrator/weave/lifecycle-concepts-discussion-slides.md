# Lifecycle Concepts Discussion Draft

Purpose: align on the new Loom lifecycle concepts, where they help, where they cost, and what to measure next.

Audience: architecture / agent lifecycle discussion.

Source: `lifecycle-concepts-toc.md` plus current phase specs.

---

## Meeting Goal

Decide which lifecycle concepts are worth keeping, tightening, or simplifying.

Focus:

- clarity of phase responsibility
- autonomy and human control
- token and runtime cost
- implementation quality
- reviewability and learning

---

## Decision Lens

For each concept:

- What problem does it solve?
- What extra ceremony does it add?
- Does it reduce downstream rework?
- Does it make failures easier to see?
- Can we measure the benefit?

---

## Lifecycle Overview

```mermaid
flowchart LR
  Seed["Seed / request"] --> Spec["Spec<br/>WHAT + WHY"]
  Spec --> G1{"Gate"}
  G1 --> Design["Design<br/>HOW"]
  Design --> G2{"Gate"}
  G2 --> Plan["Plan<br/>work graph"]
  Plan --> G3{"Gate"}
  G3 --> Build["Build<br/>execute slices"]
  Build --> G4{"Gate"}
  G4 --> Review["Review<br/>audit result"]
  Review --> G5{"Gate"}
  G5 --> Done["Lifecycle complete"]

  G1 -. optional .-> QC1["Quality check"]
  G2 -. optional .-> QC2["Quality check"]
  G3 -. optional .-> QC3["Quality check"]
  G4 -. optional .-> QC4["Quality check"]
```

Main shift: Loom turns one broad `idea -> build` lifecycle into explicit contracts between phases.

---

## Abstract Concept Flow

```mermaid
flowchart LR
  Intent["Intent"] --> Decisions["Decisions"]
  Decisions --> Stories["User stories<br/>EARS criteria"]
  Stories --> Structure["Architecture<br/>interfaces<br/>data"]
  Structure --> Graph["Task DAG<br/>coverage<br/>verification env"]
  Graph --> Slices["Vertical slices<br/>AFK / HITL"]
  Slices --> Evidence["Tests<br/>smoke<br/>mutation"]
  Evidence --> Audit["Review findings"]
  Audit --> Learning["Process learning"]
```

The key idea: every later artifact should point back to a prior contract.

---

## Phase Flow - Spec

```mermaid
flowchart TD
  A["Seed"] --> B["Repo pre-flight"]
  B --> C["Foundation questions"]
  C --> D["Branching questions"]
  D --> E["decisions.md"]
  E --> F["spec.md"]
  F --> G["User stories<br/>US-NNN + EARS"]
  G --> H["Constraints"]
  H --> I["Design-ready?"]
  I -- no --> D
  I -- yes --> J["Return to gate"]
```

Output: user intent, scope, stories, constraints, open ambiguity.

Discussion hook: do we ask fewer but better questions, or just more structured questions?

---

## Phase Flow - Design

```mermaid
flowchart TD
  A["Read spec.md<br/>read-only"] --> B["Extract structure"]
  B --> C["Components + boundaries"]
  B --> D["Interfaces + data"]
  B --> E["State + errors"]
  C --> F["ADR blocks"]
  D --> F
  E --> F
  F --> G{"Structural ambiguity?"}
  G -- yes --> H["Ask / create evidence"]
  H --> F
  G -- no --> I["design.md"]
  I --> J["Return to gate"]
```

Output: technical shape, ADRs, alternatives, unresolved structural ambiguity.

Discussion hook: is the WHAT / HOW split strict enough, or too rigid?

---

## Phase Flow - Plan

```mermaid
flowchart TD
  A["spec.md stories"] --> C["Vertical task slices"]
  B["design.md structure"] --> C
  C --> D["Stable T-NNN IDs"]
  D --> E["blocked-by DAG"]
  E --> F["Story coverage check"]
  F --> G["AFK / HITL labels"]
  G --> H["Test sketches"]
  H --> I["Verification environment"]
  I --> J["board.md + tasks/T-*.md"]
  J --> K["Return to gate"]
```

Output: executable work graph, task files, board, tests, verification contract.

Discussion hook: does the upfront planning cost pay back during Build?

---

## Phase Flow - Build

```mermaid
flowchart TD
  A["Read plan + board"] --> B{"Verification env runnable?"}
  B -- no --> C["Blocked return"]
  B -- yes --> D["Pick ready cards"]
  D --> E["Move to In Progress"]
  E --> F["Fresh task subagent"]
  F --> G["Lock"]
  G --> H["Red"]
  H --> I["Implement"]
  I --> J["Green"]
  J --> K["Done report"]
  K --> L["Review column"]
  L --> M["Smoke / mutation gates"]
  M --> N["Done column + test-report.md"]
  N --> O["Return to gate"]
```

Output: implemented slices, test logs, test report, build logs, board state.

Discussion hook: should the coordinator stay unable to implement?

---

## Phase Flow - Review

```mermaid
flowchart TD
  A["spec.md"] --> F["Audit"]
  B["design.md"] --> F
  C["plan.md + board.md"] --> F
  D["test-report.md"] --> F
  E["diff + principles"] --> F
  F --> G["Findings"]
  G --> H["Severity<br/>Blocker / Major / Minor / Note"]
  H --> I["Owner phase"]
  I --> J{"Accept?"}
  J -- yes --> K["Complete"]
  J -- no --> L["Go back / rerun"]
```

Output: structured findings, risk summary, process learning.

Discussion hook: is Review a real quality gate or just a nicer wrap-up?

---

## Selected Topic 1 - Dedicated Plan Phase

Concept: turn solution structure into an executable task graph before Build starts.

Pros:

- catches dependency cycles and missing story coverage early
- makes autonomy explicit with AFK / HITL labels
- gives Build a simple dispatch model
- creates traceability from `US-NNN` to `T-NNN`
- declares verification environment before work begins

Cons:

- adds one more phase and artifact family
- may over-plan small changes
- task DAG quality depends on good slicing
- upfront tokens increase before any code changes

Decision question: should Plan be mandatory for all work, or skippable for small safe changes?

---

## Plan Phase - Performance Bet

```mermaid
flowchart LR
  A["Extra planning tokens"] --> B["Cleaner task graph"]
  B --> C["Less Build interpretation"]
  C --> D["Fewer stuck tasks"]
  D --> E["Less rework"]
  E --> F["Lower total lifecycle cost"]
```

Hypothesis: Plan is more expensive upfront but cheaper over the full lifecycle when work has dependencies, parallelism, or acceptance risk.

Risk: for tiny tasks, Plan may be pure overhead.

---

## Selected Topic 2 - Split Spec From Design

Concept: separate WHAT / WHY from HOW.

Pros:

- separates value questions from architecture questions
- enables independent review of intent and structure
- reduces rerun cost when only design changes
- prevents quiet scope changes inside design
- gives stories a stable home before implementation planning

Cons:

- boundary disputes are likely at first
- some product and design choices influence each other
- users may feel more gates
- artifacts can duplicate language unless enforced

Decision question: what belongs in Spec only, Design only, or both by reference?

---

## Spec / Design Boundary

```mermaid
flowchart LR
  A["User value"] --> S["Spec"]
  B["Scope"] --> S
  C["Stories + EARS"] --> S
  D["Constraints"] --> S

  S --> R["Read-only contract"]

  R --> D1["Design"]
  D1 --> E["Components"]
  D1 --> F["Interfaces"]
  D1 --> G["Data + state"]
  D1 --> H["ADRs"]

  H -. contradiction .-> Q["Back to Spec<br/>open ambiguity"]
```

Rule of thumb: Design can interpret Spec, but cannot silently change it.

---

## Selected Topic 3 - Dedicated Review Phase

Concept: a fresh audit after Build, against all upstream contracts.

Pros:

- checks the body of work, not only test status
- separates author mindset from reviewer mindset
- produces severity-graded findings
- assigns issues to the right owner phase
- captures process learning while context is fresh

Cons:

- adds latency after Build
- can produce non-blocking noise
- needs clear severity calibration
- may overlap with code review and CI

Decision question: what findings should block completion versus become follow-up notes?

---

## Review Coverage

```mermaid
flowchart TD
  A["Intent satisfaction"] --> R["Review"]
  B["Design conformance"] --> R
  C["Plan completion"] --> R
  D["Test evidence"] --> R
  E["Code quality"] --> R
  F["Principles P1-P7"] --> R
  G["Safety"] --> R
  R --> H["Finding"]
  H --> I["Severity"]
  H --> J["Evidence"]
  H --> K["Expected vs actual"]
  H --> L["Recommendation"]
  H --> M["Owner phase"]
```

Review is valuable only if findings are specific, evidenced, and actionable.

---

## Selected Topic 4 - Vertical Slicing + Per-Task Subagents

Concept: each task is an end-to-end slice, built in a fresh context.

Pros:

- keeps task context small and focused
- isolates failure and debugger noise
- makes partial completion useful
- enables graph-based parallelism
- gives Review a story-to-diff audit path
- prevents coordinator scope drift

Cons:

- more handoff overhead
- cross-cutting refactors are harder to slice
- duplicate context may be reloaded per task
- parallel edits can still conflict if file scope is wrong

Decision question: how strict should the vertical-slice rule be for infrastructure-heavy work?

---

## Build Context Model

```mermaid
flowchart TD
  subgraph Forge["Forge-style shared coordinator context"]
    F1["Task 1"] --> F2["Task 2 + prior context"]
    F2 --> F3["Task 3 + more prior context"]
    F3 --> F4["Task N + accumulated noise"]
  end

  subgraph Loom["Loom fresh task contexts"]
    C["Thin coordinator"] --> L1["Task 1 context"]
    C --> L2["Task 2 context"]
    C --> L3["Task 3 context"]
    C --> LN["Task N context"]
  end
```

Expected effect: less cumulative context drag and cleaner failure isolation.

---

## Selected Topic 5 - Phase Gates + Quality Checks

Concept: after each phase, the user chooses continue, rerun, quality check, or go back.

Pros:

- keeps human control visible
- makes token spend an explicit decision
- supports targeted reruns
- preserves superseded history
- avoids silent phase drift

Cons:

- interrupts flow
- can feel heavy for routine work
- quality checks add another agent pass
- users need clear summaries to decide quickly

Decision question: which gates should be mandatory, and where can defaults safely help?

---

## KPI View

| KPI | Expected Loom movement | Why | Watch-out |
| --- | --- | --- | --- |
| Token usage per phase | Higher upfront | Spec / Design / Plan are explicit | small tasks may lose |
| Total token usage | Lower on complex work | fewer broad reruns, smaller task contexts | needs measurement |
| Wall-clock speed | Mixed | more phases, more parallel Build | gates add pauses |
| Build throughput | Higher when DAG is good | ready tasks can run concurrently | file conflicts hurt |
| First-pass quality | Higher | stories, tests, env, review are explicit | artifact quality matters |
| Rework rate | Lower | earlier failure detection | bad Plan shifts rework forward |
| Human interruptions | More visible, fewer surprise blocks | gates and HITL labels | may feel chatty |
| Auditability | Higher | stable IDs and owner phases | more files to maintain |

---

## Token Usage Hypothesis

Baseline: Forge uses fewer artifacts but lets Build inherit more accumulated context.

Loom trade:

- more tokens before Build
- fewer tokens in each Build task
- fewer full-phase reruns when only one axis is wrong
- lower chance of paying for implementation before discovering plan defects

Simple model:

```text
Forge build pressure ~= shared coordinator context + cumulative task history
Loom build pressure  ~= thin coordinator + sum(focused task contexts)
```

Measurement: record prompt + completion tokens by phase, task count, rerun count, and final Review severity.

---

## Speed Hypothesis

Where Loom should be faster:

- parallel-ready DAG tasks
- less Build interpretation
- fewer mid-build clarifications
- faster failure isolation

Where Loom may be slower:

- tiny changes
- heavy user gating
- low-quality task slicing
- optional quality checks on every phase

Measurement: wall time by phase, queue time at gates, task retry count, blocked time.

---

## Quality Hypothesis

Expected improvements:

- fewer missed acceptance criteria
- fewer hidden scope changes
- better test alignment with stories
- clearer owner phase for defects
- more reusable process learning

Quality risks:

- false confidence from well-formed artifacts
- fragmented ownership across phases
- Review fatigue if findings are low signal

Measurement: Review blocker / major rate, escaped defects, user correction count, follow-up issue count.

---

## Common KPI Dashboard

| Category | Metric | Target Direction |
| --- | --- | --- |
| Cost | total tokens per completed lifecycle | down on complex work |
| Cost | tokens per accepted story | down |
| Speed | lead time from seed to complete | down or neutral |
| Speed | build task cycle time | down |
| Reliability | reruns per phase | down over time |
| Reliability | failed / HITL-blocked task rate | down |
| Quality | Review blockers per lifecycle | down |
| Quality | acceptance criteria missed | down |
| Autonomy | AFK task completion rate | up |
| Auditability | stories with task coverage | 100 percent |

---

## Discussion Matrix

| Topic | Keep if... | Change if... |
| --- | --- | --- |
| Dedicated Plan | it reduces Build stalls and missed stories | it mostly restates Design |
| Spec / Design split | reruns become cheaper and clearer | teams fight the boundary |
| Review phase | findings prevent real follow-up work | it becomes generic commentary |
| Vertical slices | partial completion stays valuable | work is mostly cross-cutting |
| Phase gates | users make better continuation calls | gates become ceremony |

---

## Proposed Meeting Flow

1. Align on lifecycle map.
2. Discuss each selected topic: problem, pros, cons, decision.
3. Agree on KPI set.
4. Pick 1-2 pilot projects.
5. Measure Forge baseline vs Loom run.
6. Decide what to simplify.

---

## Open Questions

- Should Plan be optional for very small work?
- Should Review block completion by default, or only on Blocker findings?
- How strict should vertical slicing be for infra and refactor work?
- Which metrics are cheap enough to collect automatically?
- What is the minimum useful gate summary?

---

## Suggested Decisions To Capture

- Mandatory phases for standard work.
- Fast path criteria for small changes.
- Review severity policy.
- KPI dashboard fields.
- Pilot project selection.
- Owner for measurement instrumentation.

