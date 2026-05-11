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
| `/weave` orchestrator | [`weave/weave.md`](weave/weave.md) | State, startup, phase invocation, quality gates, resume |
| Idea Grilling Agent | [`weave/idea.md`](weave/idea.md) | Clarify seed into specified intent |
| Design Structuring Agent | [`weave/design.md`](weave/design.md) | Convert specified intent into solution structure |
| Work Graph Agent | [`weave/plan.md`](weave/plan.md) | Convert solution structure into executable work graph |
| Build Coordinator Agent | [`weave/build.md`](weave/build.md) | Execute the work graph and verify realization |
| Review Audit Agent | [`weave/review.md`](weave/review.md) | Validate outcome and capture feedback |
| Quality Check Agent | [`weave/weave.md`](weave/weave.md) | Validate phase artifacts before lifecycle advance |

## Top-Level Flow

```mermaid
flowchart TD
    A[Seed] --> B[/weave orchestrator/]
    B --> C[pipeline.md]
    B --> D[seed.md]

    B -- invoke --> E[Idea Grilling Agent]
    D --> E
    E -- artifacts --> B
    B -- quality gate --> F[Quality Check Agent]
    F -- findings --> B
    B -- rerun with findings --> E
    F -- pass --> B
    B -- invoke --> G[Design Structuring Agent]

    G -- artifacts --> B
    B -- quality gate --> H[Quality Check Agent]
    H -- findings --> B
    B -- rerun with findings --> G
    H -- pass --> B
    B -- invoke --> I[Work Graph Agent]

    I -- artifacts --> B
    B -- quality gate --> J[Quality Check Agent]
    J -- findings --> B
    B -- rerun with findings --> I
    J -- pass --> B
    B -- invoke --> K[Build Coordinator Agent]

    K -- artifacts --> B
    B -- quality gate --> L[Quality Check Agent]
    L -- findings --> B
    B -- rerun with findings --> K
    L -- pass --> B
    B -- invoke --> M[Review Audit Agent]

    M -- artifacts --> B
    B -- quality gate --> N[Quality Check Agent]
    N -- findings --> B
    B -- rerun with findings --> M
    N -- pass --> B
    B -- complete --> O[Complete]

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
