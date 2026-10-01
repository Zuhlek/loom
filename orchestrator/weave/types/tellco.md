# tellco Type

Accumulated guidance for the tellco solution — built on top of the **cinnamon** product family.

## Cinnamon Library Reuse (Critical)

- **Never reimplement utilities that cinnamon already provides.** Before writing any helper for dates, JSON conversion, or type coercion, check the cinnamon packages. We wasted a review cycle by creating a local `Dates.ts` with `dateFromJson`/`dateToJson`/`toTimestamp` when all three already existed.
- **Where to look:** `cinnamon-api` has JSON type conversion (`dateFromJson`, `dateToJson`, `numberFromJson`, `stringFromJson`, etc.) and `cinnamon-base` has date formatting (`toTimestamp`, `toISODateString`, `DateCalculator`, `DatePeriod`). Also check `cinnamon-workflow` for file and time tasks before writing custom implementations.
- **Import convention:** Always `from 'cinnamon-api'` / `from 'cinnamon-base'` — never deep-import from `out/` paths.

## Design Rules (from cinnamon)

- **DateCalculator:** All date calculations must use `DateCalculator` from `cinnamon-base`. No manual date arithmetic.
- **Dates as `Date` objects:** Internal state and workflow variables use `Date`, not strings. Convert at JSON boundaries using `dateFromJson` / `dateToJson`.

## Workflow Patterns

- **Trigger lifecycle:** pick-up/remove pattern — after reading a trigger, rename it to `.{name}.picked-up` (not delete). Remove the `.picked-up` file only on success. This prevents endless retry loops on failure while allowing manual re-trigger by renaming back.
- **Shared utilities:** Duplicated logic across workflows belongs in `TellcoWorkflowUtilities.ts`. Common variable types (`TriggerVariables`, `WorkflowVariables`) and defaults (`WORKFLOW_VARIABLE_DEFAULTS`) are defined there and extended per workflow.
## Build & Test

- Compile: `pnpm compile` — Test: `pnpm test` — Integration: `pnpm test-workflow`
- MongoDB on port 27017
- **After any tellco-interfaces changes:** run `bash test-workflow.sh` from the `tellco-interfaces/` directory to verify the full fetching → mapping workflow end-to-end.
