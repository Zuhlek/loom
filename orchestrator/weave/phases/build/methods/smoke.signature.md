# Build Smoke-Test Agent — Signature

I/O signature between the Build Coordinator and the Smoke-Test subagent.

## Trigger

**Caller:** Build Coordinator (the `phase.md` body of `phases/build/`).

**Invocation condition:** Build's per-task green phase completes AND the project is runnable. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `smoke.md` and this signature.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `plan.md` | `.loom/<project>/plan.md` | yes | Work graph + verification environment |
| `tests.md` | `.loom/<project>/tests.md` | yes | Test strategy + smoke gate spec |
| `board.md` | `.loom/<project>/board.md` | yes | Current task transitions |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-*.done.md` | yes | Per-task done reports — names what each task changed |
| Repository scripts + app entrypoints | `<repo>/...` | yes | Build/start scripts the smoke check exercises |

## Returns

### Return block

```yaml
type: object
required: [phase, status, artifacts, passed, failed, skipped]
properties:
  phase:
    enum: [smoke]
  status:
    enum: [complete, failed, skipped]
  artifacts:
    type: array
    items:
      type: string
  passed:
    type: integer
  failed:
    type: integer
  skipped:
    type: integer
```

### Writes

#### `smoke-report.md`

- Path: `.loom/<project>/smoke-report.md`.
- One entry per check (Build artifacts complete / App starts / Endpoints respond / UI screens render / Shared state intact) recording PASS, FAIL, or SKIPPED with reason.

#### `smoke-screenshots/<feature>.png` (when UI changed)

- Path: `.loom/<project>/smoke-screenshots/<feature>.png`.
- One PNG per UI-visible feature exercised.

#### `develop-log.md`

- Path: `.loom/<project>/develop-log.md`.
- Smoke observations, dual-written with `orchestrator/log/build.md`.

#### `orchestrator/log/build.md`

- Path: `orchestrator/log/build.md`.
- Matching smoke entry for the global log shard.

## Throws

| Return status | Meaning | Coordinator action |
| --- | --- | --- |
| `complete` | All checks PASS or SKIPPED with reason; no FAIL | Promote tasks from `Review` to `Done` |
| `failed` | One or more checks FAIL | Keep affected tasks in `Review`; surface failure |
| `skipped` | Project not runnable (no deliverable to smoke) | Document skip reason; no task promotion required |
