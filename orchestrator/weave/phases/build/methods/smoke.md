# Smoke procedure — runnable verification

Inline procedure the Build phase agent applies once near the end of its session, when the project is runnable. Not dispatched as a subagent.

## Checks

1. **Build artifacts complete.** Non-code files (YAML, JSON, SQL, HTML templates, static assets) are NOT copied by TypeScript or most bundlers. After running the production build, verify they exist in the output directory. If missing, fix the build script before continuing.
2. **App starts successfully.** Start the application and confirm it does not crash within the first few seconds; capture startup logs if it does.
3. **Key changed endpoints or commands respond.** Issue HTTP requests (for servers) or CLI invocations (for tools) against the endpoints / commands the build modified. Verify response shape and status — not just "did not crash". Check both pre-existing functionality and newly added behavior.
4. **Affected UI screens render when UI changed.** Use a headless browser (Puppeteer / Playwright / chromium --headless) to load each UI-visible feature added or changed by the build. Save the screenshot to `.loom/<project>/smoke-screenshots/<feature>.png` and verify the feature is visible in the rendered output, not just present in the DOM.
5. **Test runs did not corrupt shared state.** Check that the test suite did not delete or mutate persistent data without save+restore: DB configuration, on-disk files, fixtures, environment files. A test that destructively modifies shared state without restoring it is a bug — flag it as a finding and fix the test, do not just rerun the smoke check.

## Rules

- Read-only against implementation files.
- No destructive commands.
- Save screenshots under `.loom/<project>/smoke-screenshots/`.
- Record PASS, FAIL, or SKIPPED with reason for each check.

## Report schema

`.loom/<project>/smoke-report.md` — one entry per check above, in order. Each entry:

```markdown
### <check name>
**Result:** PASS | FAIL | SKIPPED
**Reason:** <one-line explanation>
**Evidence:** <command output excerpt | screenshot path | log line>
```

## Outcome

| All checks | Board action |
| --- | --- |
| PASS or SKIPPED (no FAIL) | Report `smoke: {ran: true, passed: true}` in the Build RETURN block. The orchestrator promotes Review→Done. |
| One or more FAIL | Report `smoke: {ran: true, passed: false}` in the Build RETURN block. The orchestrator leaves cards in `Review`; record the failure in the smoke report and in `test-report.md`. |
| Project not runnable (no deliverable to smoke) | Report `smoke: {ran: false}` in the Build RETURN block. Document the skip reason in `smoke-report.md` if produced. |

## Writes

| Path | Notes |
| --- | --- |
| `.loom/<project>/smoke-report.md` | One entry per check (PASS / FAIL / SKIPPED with reason). |
| `.loom/<project>/smoke-screenshots/<feature>.png` | One PNG per UI-visible feature exercised, when UI changed. |
