# Slicing Rules

How the Work Graph Agent decomposes a design into tasks. Inlined into the Plan dispatch — apply while slicing, don't restate in artifacts.

## Vertical slices

A task is a **vertical slice**: a thin thread of observable behaviour drawn through every layer it needs, end to end. The test for a slice: *when this task is Done, can a user (or a test acting as one) observe the new behaviour?* If the answer is "only after a later task lands", the cut is horizontal — re-slice.

| | Example | Why |
|---|---|---|
| **Good** | `T-001 Request a holdings export returns UVV XML for one position` — touches route, service, serializer, one test | One story clause observable end to end; every layer exercised thinly |
| **Good** | `T-002 Export denies callers unauthorized for the mandate` — extends T-001's route with the auth branch | Widens an existing thread by one behaviour |
| **Bad** | `T-001 All DB migrations`, `T-002 All service methods`, `T-003 All routes` | Horizontal layers; nothing observable until T-003; a defect in the data shape surfaces two tasks late |
| **Bad** | `T-001 Implement the whole export feature` | A story-sized monolith; no intermediate evidence, no parallelism, one giant diff to review |

A deliberate horizontal slice is occasionally right (a migration that must land atomically, a codegen step). It requires explicit justification: a decision block in `plan.md` and a one-line note in the task body — never silent.

## Granularity

- Size a task so Build can take it from red to green **within its three-attempt cap** and produce a reviewable diff: roughly one to three EARS clauses, one primary file cluster.
- **Split** when a task's test sketch pins more than ~3 behaviours, when `files-likely-touched` spans unrelated clusters, or when half the task could ship while the other half is blocked.
- **Merge** when a task's diff would be a handful of lines whose only consumer is its sibling — a task too small to fail is ceremony.
- Every task title names observable behaviour ("Export rejects invalid reportingDate"), never an activity ("Add validation helper").

## Sequencing

- **Walking skeleton first.** The first task draws one thin thread through every architectural layer the design introduces, end to end, before the work broadens. Everything after widens an existing thread.
- **Widen, don't deepen late.** No task may introduce a whole architectural layer for the first time near the end of the graph — late layers hide integration risk where it is most expensive.
- **Risk-forward.** Among unblocked tasks, order the ones most likely to invalidate the design earliest (unproven integration, external dependency, performance-sensitive path).
- Record the chosen ordering rationale in `plan.md ## Approach & sequencing` — one sentence is enough.

## AFK vs HITL

`AFK` is the default: Build executes the task autonomously. Mark `HITL` — and record a decision block in `plan.md` — when the task requires something autonomous Build must not decide or cannot do:

- A user-visible trade-off the Spec/Design record does not settle (wording, visual judgement, pricing-like choices).
- A step needing credentials, admin rights, or an external system action (enable a pipeline, create a remote resource).
- A destructive or irreversible operation on shared state (schema migration on live data, deleting user content).
- A verification gate only a human can execute (per `plan.md ## Verification environment`, e.g. `manual-browser-desktop`).

A task is NOT `HITL` merely because it is hard, large, or risky — those are sizing and sequencing problems. If more than a quarter of the graph is `HITL`, the spec has unresolved decisions: surface that in `open-ambiguity` instead of delegating it to Build-time interrupts.

## Test sketches

- Derive each sketch from the satisfied stories' EARS clauses; name the clause it pins.
- One pin per behaviour per layer — when an existing test or golden already covers the clause at that layer, the sketch **extends** it rather than adding a parallel test (P3, P6).
- Sketch behaviour, not structure: assert what the user-visible surface does, never which internal calls it makes.
