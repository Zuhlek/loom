# Audit Log

## 2026-05-12 - weave-framework-hygiene - retro-run-clean-pass

Review verdict: PASS. 0 blocker, 0 major, 0 minor findings on a 16-task
retro-run that codified six pieces of user feedback into Spec → Design →
Plan → Build → Review. All seven user stories (US-001..US-007) plus SR-01
realised on disk; sibling schemas extracted (12 new files), `validator`
prose swept from every surface except the hook filename, `_preamble.txt`
deleted, Direct Questions section removed, hook key collision closed
(`build` vs `build-task` now distinct in `VALID_STATUSES`), and four
`## Rerun Behavior` blocks propagated. No commits or destructive ops.
One process-learning note: retro-run worked as a recovery pattern, but
the friction that made retro necessary is itself worth `/tune`
attention — see `.loom/weave-framework-hygiene/feedback.md` for the
mitigations weighed (fast-path `/weave new`, `--scope refactor`
template, threshold doc).

## 2026-05-11 - loom-ui-phase-update - whitelist-pair-coupling-invariant

The change required updating two whitelists in lock-step: client
`KNOWN_ARTIFACTS` (`loom-view-live.tsx`) and server `ARTIFACT_FILES`
(`loom.ts`). The design.md doc made the invariant explicit ("ARTIFACT_FILES
must be a superset of KNOWN_ARTIFACTS"), and Build landed both edits in
one phase per Q2=B. This worked, but it's a textbook drift trap: a
future change that adds one artifact name to only one side will appear
to work in the short run (the file shows in the tree, the click does
nothing) and reads as a UI bug, not a missing whitelist entry. Two
plausible future moves:
- **Document the invariant** in a contract / lint rule (cheap, but
  relies on people reading it).
- **Single source of truth** — promote the list to a shared `@loom/...`
  constants module imported by both server and client. This is a real
  refactor with package-graph cost but eliminates the drift class.
The current change set didn't need to act on this; flagging it for
`/tune` curation as a candidate follow-up.

## 2026-05-11 - loom-ui-phase-update - single-layer-T-003-justification

T-003 ("server ARTIFACT_FILES whitelist") was a single-layer task —
ui-server only, no client-side companion in the same task. The Plan
contract requires that single-layer tasks carry an explicit
justification. T-003's spec included one: *"Single-layer (server-only)
justified: this is the one-line whitelist constant that gates disk
reads; per Q2=B the boundary was explicitly relaxed for this constant
only."* That justification ties back to the Idea-phase branching
decision and is verifiable at audit time — exactly the shape the
contract intends. Proof that the "single-layer requires justification"
rule from the Plan contract works in practice: the justification was
present, was specific, was tied to a decision artifact, and made the
audit trivial.

## 2026-05-11 - loom-ui-phase-update - first-attempt-green-on-mechanical-changes

All four tasks landed green on first attempt with zero retries. The
factors that made this possible:
- design.md included exact before/after snippets for every non-trivial
  edit (the `phaseStatesFor` rewrite, the `loom-view.tsx` ternary
  cascade rewrite, the two whitelist replacements).
- The Plan listed `files-likely-touched` accurately (no scope creep
  discovered at build time).
- The Idea-phase grep audit ("`PhaseId` consumers") was complete; no
  unexpected callers surfaced.
This is the design payoff: when the upstream phases produce concrete,
verifiable specs, Build becomes mechanical and Review becomes short.
Worth holding up as a reference shape for future small refactors.

## 2026-05-11 - phase-validators - single-invocation-lifecycle-mid-project

The orchestrator originally exited after each phase
(one-decision-per-invocation). Mid-project the user edited
`weave/SKILL.md` to loop until Review→done in a single invocation,
adding a `Lifecycle state` framework with `active` / `complete`
values. The phase-validators project spans both eras: Idea ran under
the exit-after-phase model (separate `/weave` invocations), then
Design / Plan / Build / Review ran under the loop-until-done model
(single `/weave` invocation). The seam was crossed cleanly because
`pipeline.md` is the canonical state surface and both orchestrator
modes read/write the same sections — the only added field on the new
model is `Lifecycle state`, which the existing parser was
forward-compatible with. This validates the "pipeline.md is canonical
state" architectural commitment: the orchestrator's own behavior can
change while in-flight projects continue without state-loss. Reusable
cue: when the orchestrator's loop semantics change, projects in
flight survive iff every modified section is additive on
`pipeline.md`.

## 2026-05-11 - phase-validators - recursive-orchestrator-self-edit

This project recursively edited the very orchestrator that drove
it — the three new `validator.md` files live under the same
`orchestrator/weave/phases/` tree that the orchestrator reads on
dispatch. No reload cycle was needed at any point because
`validator.md` is loaded by file presence (predicate-based dispatch:
"if `phases/<phase>/validator.md` exists, the user gets the
three-option rerun-or-continue surface"), not by code that requires
re-import. The recursion is shallow — the orchestrator didn't
dispatch the new validators against this project, it just authored
them — but the architectural invariant ("orchestrator surface is
file-presence-driven, not code-driven") is what made it safe to
self-edit. Reusable cue: predicate-based file-presence dispatch is
what enables an orchestrator to extend itself in-flight without a
restart cycle.

## 2026-05-11 - phase-validators - verbatim-duplication-as-deliberate-no-helper-tradeoff

The seed forbade shared helper files (`no shared helpers; each
validator.md is self-contained, like phases/idea/validator.md`). Q05
+ Q06 affirmed this — each new validator restates the same ~30 lines
of Output template + severity rubric + User-Facing Decision paragraph
+ RETURN YAML block. This violates P3 (Zero Duplication) on a
literal-line-count reading. The deliberate trade-off: extending the
validator family in the future (or editing the boilerplate) requires
touching all N files in lock-step, but the orchestrator dispatch path
stays trivial (no include / partial mechanism) and each validator
file is independently readable. The mitigation: T-007's grep gates
re-assert all the boilerplate per-file, so drift is caught at
next-rerun-or-CI time. Worth capturing because future contributors
may want to extract a `templates/validator-frame.md`; this entry is
the record that the current setup is *intentionally* duplicated, not
accidentally so. Reusable cue: P3 is *negotiable when the duplication
is by-design and gate-asserted*; flag for `/tune` re-evaluation if
the boilerplate ever grows past one screen or starts to drift in
practice.


## 2026-05-12 - chat-ui-parity - depth-2-subagent-dispatch-gap

Standard `phases/build/phase.md` work loop step 3 says the Build
Coordinator MUST dispatch a fresh Task subagent per task. In this
harness, subagents do NOT expose a Task/Agent primitive — depth-2
dispatch is impossible. First Build Coordinator returned `status:
blocked` cleanly without modifying the repo or the board.
Orchestrator (user-facing session) took over as Coordinator and
dispatched task-builders at depth-1. Outcome identical for the
project's purposes; the work-loop contract that gives each task a
fresh context is preserved either way (only the dispatch boundary
moves). Reusable cue: if a Build Coordinator pre-flight surfaces
no Task primitive, fall back to depth-1 dispatch from the
orchestrator session. The framework should either document
orchestrator-as-Coordinator as the canonical fallback path or
provide a depth-2 dispatch primitive in the subagent toolset.

## 2026-05-12 - chat-ui-parity - smoke-first-walk-pre-build-context-engineering

The 7-flow live smoke checklist (Spec ## Constraints, Q10 done-bar)
passed 7/7 on the first manual browser walk — no flow needed retry,
no T-NNN re-open, no rollback to a prior phase. Two plausible
contributors: (1) the autonomous Build's wire-mirror discipline
(T-010's `wire-mirror-drift.test.ts` proved 10 unions byte-identical
before T-011 ran) and (2) the upstream context-engineering depth —
heavy grilling on Q01..Q10 closed the ambiguities that would
otherwise have surfaced as live-smoke regressions. Bundle delta also
landed at the favourable end of the budget window (59.78 vs 60-80 KB)
so the ADR-005 escape valve was never needed. Reusable cue: when an
iteration lands first-walk smoke success, audit whether Spec invested
enough in grilling-Q depth to retire ambiguities before Build. Inverse:
first-walk smoke failure should prompt looking at whether Spec rerun
depth was sufficient.

## 2026-05-12 - weave-phase-folder-restructure - predecessor-undo discipline threaded forward end-to-end

The user supplied `predecessor-undo-note.md` at the Spec gate listing
per-file obsolete-vs-survives breakdown of uncommitted edits from the
predecessor `weave-framework-hygiene` project. The note was threaded
through every downstream phase: Spec ingested it as repo-context, Plan
surfaced it as a constraint in `plan.md` and pulled per-file callouts
into T-001 / T-002 task specs, Build consolidated to the final shape
rather than additively layering on the predecessor's edits. Every
Build task that touched a predecessor-edited file (T-001 cross-cutting
plus T-002 / T-005 per-phase) enumerates in its done.md which predecessor
edits survived (terminology updates like Validator → Quality Check) and
which were removed as obsolete (`*.return.schema.yaml` sibling-file
references, Load-Order step 6 loading the schema YAML, "Phase return
schema" rows in the renamed signature.md and README.md). Reusable cue:
when a project's working tree carries uncommitted edits from a
predecessor that is partially superseded, a per-file
obsolete-vs-survives note at Spec gate consumed by Plan as a constraint
and threaded into cross-cutting task specs prevents the
"additively-edited on top of half-obsolete edits" failure mode that
otherwise breaks ref-sweeps at the end of Build.

## 2026-05-12 - weave-phase-folder-restructure - convention-exempt files still participate in ref-sweep

ADR D-06 exempted Spec's reference docs (`methods/categories.md`,
`methods/grilling.md`, `methods/stories.md`) from the
two-files-per-callable convention because they are not callables.
T-007's Layer D global ref-sweep nonetheless found 2 inline `agent.md`
cross-references in `grilling.md` pointing at the (now-renamed)
sibling Spec agent body. Build rewrote them to `phase.md` to satisfy
the ref-sweep. The distinction "exempt from convention shape" vs
"exempt from ref-sweep cleanup" was implicit, not explicit, in D-06.
Reusable cue: when a refactor renames siblings that
convention-exempt files cross-reference, the exempt files still need
ref-sweep updates. Audits should explicitly enumerate the ref-sweep
scope independently of the convention-shape scope so the two scopes
don't collapse into one "is this file in scope" question that lands
on the wrong side for one of them.

## 2026-05-12 - weave-phase-folder-restructure - review-as-project-quality-check landed clean

Review's audit checklist covered intent (US-001..US-007 acceptance
criteria, all observable on disk), design (ADR D-01..D-08 each with
concrete evidence), plan (board 7/7 done, all per-task done reports +
test logs present), test evidence (independently re-running Layer
A/B/C/D assertions), code quality (P3 zero-duplication enforced via
body cleanliness check), safety (HEAD unchanged, 9 renames as `R`,
hook untouched, no commits), and user feedback (predecessor-undo
note consumed correctly). Total: 0 blocker, 0 major, 0 minor. Two
notes recorded for the record (convention-exempt-ref-sweep and
predecessor-undo discipline). Reusable cue: when Build's
working-tree-change-report and test-report already enumerate the
verification layers with per-layer pass/fail, Review's role narrows
to independent re-execution of the load-bearing assertions plus
cross-checking that the ADR / story claims map to working-tree
observable evidence. The audit time is shorter than the build time
because the verification surface is already well-organized.

## 2026-05-12 - chat-ui-parity - smoke-coverage gap

A 7/7 live smoke run can still ship two crash-grade bugs if the smoke
flows do not exercise the partial-message-batch path or any tool whose
content-block index lands at >0. For chat-style projects: smoke
contracts should include a sustained-thinking turn, a TodoWrite-triggering
turn, and a multi-tool-in-one-turn flow alongside the canonical happy /
streaming / permission / AskQ / resume / interrupt / plan flows.

Source: chat-ui-parity follow-up loom `chat-streaming-fixes` opened
same day after first-dogfooding regressions.

## 2026-05-12 - chat-streaming-fixes - smoke-coverage extension caught the bugs it was designed to validate

Counter-example to "smoke checklists are theatre". The parent
`chat-ui-parity` loom shipped with a 7-flow live smoke that walked
canonical happy / streaming / permission / AskUserQuestion / resume /
interrupt / plan-mode paths and missed two crash-grade bugs because
none of those flows exercised multi-batch partial-stream events or
any tool whose `content_block_start` index lands at >0.

chat-streaming-fixes added three flows specifically targeted at the
failure modes: flow 8 (sustained thinking — multi-batch partials),
flow 9 (TodoWrite — high-index tool_use), flow 10 (multi-tool —
non-sequential block indices across multiple SDK messages in one
turn). On the T-004 HITL walk:

- Flow 8 caught the row-spam regression (would have shown six
  "Thinking…" rows had the fix not landed). PASS confirmed bug 1
  fixed.
- Flow 9 caught the TodoWrite React crash directly with the exact
  prompt that surfaced bug 2 originally ("can you make some dummy
  tasks for testing"). PASS confirmed bug 2 fixed.
- Flow 10 validated that the per-SDK-message row UX (Q04 option B)
  matches t3code's behaviour on multi-tool turns.

Process lesson: codified smoke flows targeting known failure modes
DO pay off. When a regression is found in production / dogfooding,
the right move is to encode the missing flow in the next iteration's
smoke list — not to rely on review caution. Reusable cue: when a
follow-up loom opens after a parent loom's smoke missed a real-world
bug, the iteration's spec.md `## Constraints` should explicitly add
the targeted flow that would have caught it, and the iteration's
T-NNN-HITL walk should re-confirm the previously-green parent flows
alongside the new ones — both as regression check and as proof the
extension didn't break inherited coverage.

Source: `.loom/chat-streaming-fixes/` review.

## 2026-05-12 - framework-audit - Review verdict (pass; 3 notes for follow-up)

**Outcome:** Review verdict `pass` for the framework-audit loom. Zero blockers, zero major issues, three `note`-severity findings recorded for follow-up routing (no rework requested of Build).

**Substantive cross-check performed by Review:**

- Re-ran the strict-gate grep `grep -rnE '(^|[^.])\bloom/(lib|hooks|orchestrator|weave|types|principles|templates|setup-loom)' orchestrator/` and confirmed exactly 3 hits, all in `setup-loom.sh:9,79,93` (intentional migration regex per design). Build's Gate 1 PASS verified.
- Re-counted repo-context Flavour 1 enumeration: 32 line entries across 12 files + the 35th `hooks/README.md:13` = 33 hits to discharge. Cross-referenced against `findings.md` F1-* IDs: 33 IDs allocated, every repo-context-enumerated file has a matching finding. Coverage complete.
- Spot-checked the 4 gate-feedback dispositions: Q04 (principles.md row absent from spec/phase.signature.md), Q05 (categories.md:3 rewritten to remove hook overreach + describe Spec agent's self-validation), Q09 (build/phase.md:41-47 + build/methods/task.md:13 carry the "agent-discipline" downgrade), Q10 (no tune-shard Flavour 5 finding present; N-T-005-001 records the disposition).
- Verified US-008 AC3: `ui/apps/server/src/routes/loom.ts` mtime (15:06) predates Build's first task (16:12). Build did not modify loom.ts. The loom.ts diff present in the working tree is pre-existing constitution-cleanup state from "last session" (per seed §55), not an audit-Build edit. F2-T-008-001..002 record the UI phantoms as Document-triage notes.
- Re-ran `setup-loom.sh` re-run idempotency check: `findings.md` § Integration assertions records exit-0, 5 distinct canonical hook entries (0 duplicates), 4 symlinks resolved. Gate 6 PASS verified.

**Three notes routed to a follow-up framework-hygiene loom:**

- **F-001:** Build phase did not write `tasks/T-NNN.done.md` / `tasks/T-NNN.test-log.txt` despite the Build signature (`weave/phases/build/phase.signature.md:82-101`) requiring both. Substantive verification evidence lives in `test-report.md` per-task table instead. Strict Gate 5 in `tests.md` cannot be evaluated at the artifact location it names; the substantive cross-reference exists at a different location. Recommends a Spec-level Choice: (1) downgrade the signature to make these files conditional on task type (audit/doc-edit vs code+test); (2) tighten the Coordinator enforcement to fail Build status when a Done task lacks both files. Option (1) is the symmetric fix to Q09 (downgrade doc claim); option (2) is the symmetric fix to "extend the hook" (rejected by Q09 on scope grounds). This is itself a flavour-5-class observation (stale contract: the signature promises artifacts the framework's Build coordinator does not always produce) — exactly the kind of finding that motivates a follow-up framework-hygiene loom.
- **F-002:** Working tree co-ships pre-existing constitution-cleanup edits (6 files at mtime 15:04–15:06, predating Build's 16:12 start) with the audit's diff. Includes the deletion of `orchestrator/templates/constitution.md`, principles.md preamble rewrite, README.md template row update, signature.md / create-project.md constitution stripping, review/phase.md `## Reads first` insertion, and the `ui/apps/server/src/routes/loom.ts` `"constitution.md"` removal from ARTIFACT_FILES. The seed (§55) treats these as "this session" work — the user explicitly expected the prior session's edits and this audit's edits to ship together. Transparency note for the user; no audit-side rework needed.
- **F-003:** `N-T-000-001` (harness Task-dispatcher absence) recorded by Build is the exact bug class the audit was built to surface. Framework body files repeatedly claim "fresh `Task` subagent" dispatch without acknowledging that whether `Task` is available is a harness-level capability dependency. Recommends a Spec-level Choice: (a) document the dual-mode reality in body text (Coordinator MAY run in-process when `Task` is unavailable AND each task's surface is bounded enough that in-process preserves correctness); (b) tighten the contract to fail when `Task` is absent. Surfaced to a follow-up loom rather than counted against this audit's correctness.

**Positive pattern worth carrying forward:** read-and-cite verification (ADR-05) is sufficient for a documentation-edit loom. No test harness was introduced, no new dependencies were added, and deterministic shell assertions (grep, readlink, python3 settings.json parse) provide the same audit-trail property a test runner would, at a fraction of the token cost. Recommend reusing this verification-environment pattern for future doc-edit / hygiene looms.

**Cross-references:** `.loom/framework-audit/review.md`, `.loom/framework-audit/findings.md`, `.loom/framework-audit/develop-log.md`.

## 2026-05-12 - loom-ui-parity-gaps - Cross-phase audit observations

Two of the user's Spec-grilling free-text answers were strictly
stronger than the Y/N option sets they answered:

- **Q3 — dev-only routes.** Options were YES (gate behind `__dev`) /
  NO (leave at top-level with a banner). User free-text:
  *"remove those mockup url, references and code. only production
  ready code remains."* That's a third option: outright deletion.
  Spec correctly captured this into ADR-003 (deletion, not gating) and
  US-004 ACs (no route registrations, no backing components).
- **Q7 — Trusted-VM.** Options were (A) relabel UI / (B) rename
  end-to-end / (C) actually sandbox. User free-text:
  *"we just mean that the agent is opened with
  --dangerous-skip-permission mode. the app will run locally only,
  mostly in vm's of a developer."* That's a fourth option: keep the
  label, fix only the subtitle copy to be honest about the trust
  boundary, no sandboxing. Spec captured this into US-006 AC2 +
  out-of-scope explicit-no-sandbox clause.

In both cases the user's answer was a deliberate upshift / reframe,
not a non-answer. The Spec agent caught it and routed it correctly.

Reusable lesson: free-text answers to Y/N or Choice questions should
be treated as potentially-stronger superseding inputs, not as "no
answer received, fall back to recommendation". The framework's
question-format spec (`orchestrator/weave/phases/spec/categories.md`)
should explicitly acknowledge that a free-text response can introduce
a third option, reframe the choice, or upshift the bar — and the
Spec agent should write a `Status: answered (free-text supersedes
Y/N)` annotation in `decisions.md` when this happens (this loom's
Spec agent did exactly that on Q3 and Q7 — pattern worth preserving).

A second cross-phase observation: the test report flagged that
`metadata-store/repos/chat.ts` *already* persists `worktree_path` as
a column, even though `spec.md ## Constraints` framed it as
"runtime-only / no new persisted column" (Review finding R-002 in
`.loom/loom-ui-parity-gaps/review.md`). The intent of the constraint
was "no new schema churn introduced by this spec"; the wording read
more strictly. Build correctly preserved the observed behaviour
rather than rip out pre-existing persistence to honor a literal
reading of the constraint. Future Spec agents should distinguish "no
new column added by this spec" from "field is runtime-only end-to-end"
when writing constraints.

**Cross-references:** `.loom/loom-ui-parity-gaps/decisions.md` Q3 +
Q7; `.loom/loom-ui-parity-gaps/spec.md ## Constraints`;
`.loom/loom-ui-parity-gaps/test-report.md ## Notes for the reviewer`;
`.loom/loom-ui-parity-gaps/review.md` finding R-002.

## 2026-05-13 - diff-features - Build "green" can hide a missing production wire-up

R-001 (Blocker) in diff-features Review: `mountGitStatusRoute` was
implemented as a route module and 8 unit tests assert its handler
behaviour, but the function is never invoked in
`ui/apps/server/src/index.ts`. The route returns 404 in the running
server. The Build Task Builder's done.md falsely claimed the mount
was added at line 139; the per-task suite couldn't catch the false
claim because the tests construct a private `routes` object and call
`mountGitStatusRoute(routes)` directly, which always passes in
isolation.

**Audit lesson:** when a task's deliverable is a route module, the
Review check should not stop at "tests green + handler file exists".
It must also verify the production mount path — at minimum, grep
`server/src/index.ts` for the `mount*Route(routes)` call. A
follow-on improvement: Build-phase smoke gate should boot the server
and curl each new endpoint; per-route unit tests in isolation are
insufficient.

**Cross-references:** `.loom/diff-features/review.md` finding R-001;
`.loom/diff-features/tasks/T-004.done.md` (claims mount at line 139);
`ui/apps/server/src/index.ts` lines 25-34 + 135-144;
`ui/apps/server/test/git-status-route.test.ts` lines 29-33.

## 2026-05-13 - diff-features - ADR-deviation downstream: a refactor's preceding step can become dead code

Design ADR-6 in diff-features added optional controlled `scope` /
`onScopeChange` props to `DiffPanelShellProps` so the
worktree-panel container could drive the scope toggle through the
shell. T-002 implemented the controlled-scope plumbing. T-008
later deviated — its container inlines the scope toggle and renders
`<BranchToolbar>` + `<DiffFileCard>` directly without going through
the shell. T-008.done.md records the deviation with rationale, but
the consequence (ADR-6 has no consumer; the controlled-scope
plumbing is dead code) was not flagged until Review. Surface this
as a recurring audit check: when a Build task deviates from an
ADR's downstream-consumer assumption, ask "does the deviation
invalidate the preceding refactor?"

**Cross-references:** `.loom/diff-features/review.md` finding R-002;
`.loom/diff-features/design.md` ADR-6;
`.loom/diff-features/tasks/T-002.done.md` (controlled-scope props);
`.loom/diff-features/tasks/T-008.done.md` "Deviations from task spec"
#2 ("container does NOT wrap DiffPanelShell for scope rendering").

## 2026-05-13 - diff-features - Pre-existing-failures baseline tracking lets a noisy suite still gate regressions

The diff-features Build phase started with 6 pre-existing web test
failures (`composer-attachments.test.ts` x5,
`queued-input-policy.test.ts` x1) and 3 pre-existing tsc errors in
`routes/live-chat.tsx:511-513`. Every task's done.md cross-verified
`delta = 0` against this baseline via `git stash` + rerun. The
discipline let the Build coordinator distinguish new regressions
from inherited baseline cleanly across 8 parallel tasks. Worth
codifying as a recurring expectation: every Build done.md asserts
a delta-vs-baseline number, not just "tests green". Already
established in `orchestrator/log/build.md`; surfacing here as the
cross-phase audit pattern.

**Cross-references:** `.loom/diff-features/test-report.md ## Suite
totals`; every `tasks/T-NNN.done.md` "Test summary" section in
diff-features.

## 2026-05-13 - diff-features - Orchestrator-direct fix in lieu of Build re-dispatch for localized Review blockers

After the first Review of diff-features returned `fail` with one
Blocker (R-001 missing `mountGitStatusRoute` invocation in
`ui/apps/server/src/index.ts`) and one Minor (R-003 misleading
`DiffFileCard.tsx` comment block), the orchestrator did not
re-dispatch a full Build phase. The standard recovery path
(Review fail → Build rerun on the failing tasks → Review
re-audit) would have re-run 8 task contexts to add a single
`mountGitStatusRoute(routes);` line plus a one-line import and
rewrite a misleading comment block — disproportionate cost.

Instead the orchestrator applied both edits directly (two-line
add to `index.ts` at lines 29 + 141, comment block rewrite at
`DiffFileCard.tsx:12-13`), then dispatched a Review re-audit.
The re-audit verified each fix in place, re-ran the impacted
test suites (16 server route tests + 25 DiffFileCard tests, all
green), and confirmed no new findings were introduced. Final
verdict moved to `pass-with-accepted-risk` (the two Majors from
the first audit, R-002 / R-006, were explicitly accepted as
follow-ups by the orchestrator on the re-dispatch).

**Audit lesson:** the framework's "Review fail → Build rerun"
default has an implicit escape valve for one-line oversights
that the per-task evidence already covers behaviourally. For
diff-features, `git-status-route.test.ts` already exercised the
handler exhaustively in isolation; the gap was strictly the
production wire-up, not the handler logic. Re-running T-004's
full context to add a single mount call would have been Build
theatre rather than Build value.

Worth surfacing for `/tune`: codify the orchestrator-direct
branch in the Build-rerun decision tree explicitly. Suggested
predicate: "if all Review blockers are localizable to ≤2 lines
of source change AND don't require new tests AND the existing
test evidence covers the handler/component behaviour
in-isolation, the orchestrator MAY apply the fix directly and
dispatch Review re-audit only (skipping a full Build rerun)."
Without this codification, future weaves may hit the same
oversize-recovery pattern.

**Cross-references:** `.loom/diff-features/review.md` (cycle-2
re-audit); `.loom/diff-features/develop-log.md` (
`2026-05-13 - diff-features - Orchestrator-direct fix path for
one-line oversights` entry); `ui/apps/server/src/index.ts` lines
29 + 141; `ui/apps/web/src/components/diff/DiffFileCard.tsx`
lines 12-13.
