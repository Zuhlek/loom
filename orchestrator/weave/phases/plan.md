# Plan

Convert the design into an executable work graph. You own `plan.md` in the workspace.

Read first: `spec.md` (stories and constraints), `design.md`, `repo-context.md`.

## Work loop

1. Slice work vertically (see Slicing below). Each task delivers a thin slice of one or more stories' acceptance criteria.
2. Assign stable `T-NNN` IDs. Build the blocked-by graph; no cycles; every active story covered by at least one task.
3. Declare the verification environment (see below).
4. Give each task a test sketch derived from its stories' EARS clauses, likely file scope, and acceptance criteria references.
5. Validate coverage before returning: every active story covered, every blocked-by resolves.

## `plan.md` shape

```markdown
## Approach
<short: order of work and why>

## Verification environment
<label> - <one line on what the harness needs>

## Tasks
- T-001 [todo] <title> (blocked-by: -) (stories: US-001)
- T-002 [todo] <title> (blocked-by: T-001) (stories: US-002)

### T-001 <title>
- stories: US-001
- files: <best-guess scope>
- acceptance: <criteria refs or one-liners>
- tests: <behavior-level sketch>
```

The `## Tasks` list is the single status source; Build updates it in place. States: todo, doing, done, failed, blocked. Task detail sections carry no status.

Verification environment labels: `node-test`, `python-test`, `cli-shell`, `headless-browser` (Build runs these alone), `manual-browser-desktop` (a human must verify; Build will block if it cannot execute the gate), `none` (docs or config only). Build refuses to silently substitute a different harness, so pick what the repo actually supports.

## Slicing

- A task is a vertical slice: when it is done, a user or a test acting as one can observe the new behavior. If the behavior is only observable after a later task, the cut is horizontal - re-slice. A deliberate horizontal slice (atomic migration, codegen) needs a one-line justification in the task section, never silent.
- Size for Build's three-attempt cap: roughly one to three EARS clauses, one primary file cluster. Split when a task pins more than three behaviors or spans unrelated clusters; merge when a task is too small to fail.
- Titles name observable behavior ("Export rejects invalid date"), never an activity ("Add validation helper").
- Walking skeleton first: the first task draws one thin thread through every new architectural layer end to end; later tasks widen existing threads. No task introduces a new layer near the end of the graph. Among unblocked tasks, order the riskiest first.
- Mark a task `(HITL)` after its title only when Build must not or cannot do it alone: an unsettled user-visible trade-off, credentials or external-system actions, destructive operations on shared state, or a human-only verification gate. Hard, large, or risky is not HITL. If more than a quarter of the graph is HITL, the spec has unresolved decisions - return them as open ambiguity instead.

## Rerun

Existing `plan.md` is the starting point. Keep task IDs; never renumber. Move invalidated done tasks back to `[todo]` with a note instead of deleting them.

## Finish

Append one line `## [<date>] <project> - plan: <one-line learning>` to `<workspace>/develop-log.md`; when Develop-log is global, also to `~/.claude/develop-log.md`.

End with:

```yaml
RETURN
phase: plan
status: complete | blocked | failed
artifacts: plan.md
summary: <one line>
pending-user-input: <only when blocked>
```
