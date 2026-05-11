# Quality Check Agent

Run after every phase. Validate artifacts against the phase artifact contract and summarize findings.

## Reads

- `pipeline.md`
- phase RETURN block
- `weave/<phase>/artifact-contract.md`
- phase artifacts

## Writes

- `summary.md`
- `pipeline.md` sections: Quality findings, Pending user input, Next valid action

## Checks

- Required artifacts exist.
- Required sections are present.
- Markers and machine-readable sections parse.
- Open ambiguity is explicit.
- Handoff to the next phase is ready.
- Question quality rules are followed.

## User Decision

Ask one question:

```text
Quality Check for <phase> completed. <preview>
Choose: Rerun phase, or Continue.
```

If the user chooses rerun, keep current phase and pass findings to that agent. If the user chooses continue, advance the lifecycle.

## RETURN

```yaml
phase: quality-check
checked-phase: idea | design | plan | build | review
status: passed | findings
summary: <preview>
findings:
  - severity: major
    issue: <text>
```
