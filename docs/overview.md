# Loom

Loom is a context and prompt orchestration framework for AI-agent-driven software development.

## Lifecycle

Primary command: `/weave`

Primary workspace: `.loom/<project>/`

Primary state file: `.loom/<project>/pipeline.md`

| Phase | Agent | Core Question | Input | Output | Ambiguity Removed |
| ----- | ----- | ------------- | ----- | ------ | ----------------- |
| Idea | Idea Grilling Agent | Why should this exist, and what must be true for it to be correct? | Opportunity/problem | Specified intent | Intent + behavior |
| Design | Design Structuring Agent | How should it work? | Specified intent | Solution structure | Structure |
| Plan | Work Graph Agent | How will it be executed? | Solution structure | Executable work graph | Execution |
| Build | Build Coordinator Agent | Can the solution be realized? | Work graph | Working system | Realization |
| Review | Review Audit Agent | Did the result satisfy intent? | Working system | Validation + feedback | Outcome uncertainty |

## Agent Model

| Agent | Defined In | Scope |
| ----- | ---------- | ----- |
| `/weave` orchestrator | [`weave/weave.md`](weave/weave.md) | State, startup, phase invocation, rerun-or-continue decision, resume |
| Idea Grilling Agent | [`weave/idea.md`](weave/idea.md) | Clarify seed into specified intent |
| Design Structuring Agent | [`weave/design.md`](weave/design.md) | Convert specified intent into solution structure |
| Work Graph Agent | [`weave/plan.md`](weave/plan.md) | Convert solution structure into executable work graph |
| Build Coordinator Agent | [`weave/build.md`](weave/build.md) | Execute the work graph and verify realization |
| Review Audit Agent | [`weave/review.md`](weave/review.md) | Validate outcome and capture feedback |
| Quality Check Agent | [`weave/weave.md`](weave/weave.md) | Opt-in: analyse a phase's artifacts to inform a rerun decision (Idea phase only for now) |

## Other Skills

| Skill | Purpose | Usage |
| --- | --- | --- |
| `/tune` | Meta-layer: feedback, develop-log curation, transcript insights | `/tune [<text> \| review \| insights]` |

## Top-Level Flow

After every phase, the orchestrator returns control to the user with a rerun-or-continue decision. Quality Check is opt-in (currently Idea phase only) and exists to inform the user's rerun choice — never to gate the lifecycle automatically.

```mermaid
flowchart TD
    A[Seed] --> B[/weave orchestrator/]
    B --> C[pipeline.md]
    B --> D[seed.md]

    B -- invoke --> E[Idea Grilling Agent]
    D --> E
    E -- artifacts --> B
    B -- ask user --> U1{Continue / QC / Rerun?}
    U1 -- Run quality check --> F[Quality Check Agent]
    F -- quality-review.md --> B
    B -- show findings, ask --> U2{Continue / Rerun?}
    U1 -- Rerun --> E
    U2 -- Rerun --> E
    U1 -- Continue --> G[Design Structuring Agent]
    U2 -- Continue --> G

    G -- artifacts --> B
    B -- ask user --> U3{Continue / Rerun?}
    U3 -- Rerun --> G
    U3 -- Continue --> I[Work Graph Agent]

    I -- artifacts --> B
    B -- ask user --> U4{Continue / Rerun?}
    U4 -- Rerun --> I
    U4 -- Continue --> K[Build Coordinator Agent]

    K -- artifacts --> B
    B -- ask user --> U5{Continue / Rerun?}
    U5 -- Rerun --> K
    U5 -- Continue --> M[Review Audit Agent]

    M -- artifacts --> B
    B -- ask user --> U6{Continue / Rerun?}
    U6 -- Rerun --> M
    U6 -- Continue --> O[Complete]

    C -. resume .-> B
```

## Documentation Map

| File | Scope |
| ---- | ----- |
| [`weave/weave.md`](weave/weave.md) | `/weave` orchestration contract |
| [`weave/idea.md`](weave/idea.md) | Idea phase contract |
| [`weave/design.md`](weave/design.md) | Design phase contract |
| [`weave/plan.md`](weave/plan.md) | Plan phase contract |
| [`weave/build.md`](weave/build.md) | Build phase contract |
| [`weave/review.md`](weave/review.md) | Review phase contract |
