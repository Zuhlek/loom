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

## 2026-05-13 - composer-attachments-and-at-file - Second-pass Review: verify prior findings against current working tree

Cross-phase Review pattern observation. When the user chooses "Go
back to Build" at a Review gate and Build re-opens specific cards
with fixes, the next Review pass should NOT simply re-run the prior
findings list as a checklist. The working tree is the source of
truth — each prior finding's premise must be verified against the
CURRENT state (grep, tsc, Read) and explicitly marked RESOLVED /
INVALID rather than re-narrated.

**Concrete example from this loom (second pass).**

Prior Review (2026-05-12) raised:
- Major #1: `sdkContent: unknown` widens past SDK MessageParam type
  contract at `claude-session-bridge.ts:1399`; TS2345 at push sites
  ~1428 + ~1442.
- Minor #1: `[data-dragging]` CSS rule claimed in T-008 done.md but
  not landed in styles.css.

Build re-open (2026-05-13) landed fixes. Second Review pass verified:
- `grep -n "sdkContent\|SdkContent" claude-session-bridge.ts` → shows
  indexed-access types `SdkContent = SDKUserMessage["message"]["content"]`
  + `Extract<...>` aliases at lines 1423-1428; no `unknown`
  declaration.
- `pnpm tsc --noEmit -p apps/server 2>&1 | grep -E
  "TS2345|claude-session-bridge\.ts:14(2[0-9]|3[0-9]|4[0-9]|5[0-9])"`
  → zero matches.
- `grep -n "dragging\|drag" apps/web/src/styles.css` → rule present
  at line 175 with documented block comment.

Both findings marked INVALID against current working tree. NOT
re-raised. New review.md explicitly states each prior finding's
verification status in a dedicated "Prior-finding verification"
section before stating the new verdict.

**Why this matters.** Re-raising a finding the working tree has
already closed (a) adds noise the user must wade through to
understand what changed; (b) erodes trust in the audit; (c) creates
a perverse incentive to "look thorough" by re-stating known
information. The Review Audit Agent's job after a Build re-open is
to confirm closure, not to re-narrate the original problem.

**Recommended convention.** When the Review phase signature receives
a `superseded/<timestamp>/review.md` input (i.e., this is a second
or later pass), the new `review.md` MUST include a "Prior-finding
verification" section that walks every prior Blocker / Major / Minor
finding, records the verification method used (grep / tsc / test
run), and marks the finding RESOLVED / INVALID / STILL-OPEN against
the current working tree. Findings not closed by the re-open get
re-raised; findings the re-open closed do not.

**Cross-references:**
`.loom/composer-attachments-and-at-file/review.md` (the
"Prior-finding verification" section); `.loom/composer-attachments-and-at-file/superseded/20260512T214740Z/review.md`
(the prior pass); `ui/apps/server/src/process-manager/claude-session-bridge.ts`
lines 1415-1459; `ui/apps/web/src/styles.css` lines 165-178.

## 2026-05-13 — csd-717-swift-mapper-pr-feedback — Review pass

**Cycle outcome:** conditional pass — 10 of 10 user stories shipped on
`CSD-717-clean` of `repo/aper/aper-interfaces` (commits `e757f3d` ..
`b92efa7`); 8 of 8 ADRs honoured in structure; `tsc` green on HEAD; one
major finding (US-004 partial deletion) routed back to Build as a
single follow-up task.

**Cross-phase observation — done.md hygiene.** Of 10 AFK tasks, only 5
produced `tasks/T-NNN.done.md` reports (T-001, T-003, T-004, T-005,
T-007). The other 5 (T-002, T-006, T-008, T-009, T-010) shipped commits
but skipped the done.md write step. T-007's done.md is an
orchestrator-written reconstruction after a subagent usage-quota kill.

The Review-found US-004 gap (two `parseSwiftDate` private helpers not
deleted; 8 call sites un-migrated) correlates with the missing T-006
done.md — Build never enumerated the call sites in an audit report, so
the position/transaction-side asymmetry slipped through. With a done.md
the subagent would have had to list "files changed" and would likely
have noticed the transaction-side files were absent.

**Cross-phase observation — Spec / Design rerun cost.** The Design QC
flagged an ADR-08 vs US-008 AC1 contradiction; user softened the AC on
rerun rather than reshape the design. Resolution was clean (one Spec
edit + one ADR-08 update + one decisions.md Q05 revision), but it
demonstrates that load-bearing ACs derived from a Spec-time grilling can
be over-strict when subsequent Design work reveals a structural
contradiction. The user's directive on this kind of contradiction is
"soften the AC, keep the design"; QC review.md should surface "alternative:
spec amendment" as a first-class resolution route alongside "rerun phase".

**Cross-phase observation — calvin-bmpi as required reading.** Q02's
resolution (always-emit pattern) was anchored entirely in calvin-bmpi's
legacy `TransformTransactionsTask.transformMessages` template. Without
that grounding the design would have invented a third pattern. Calvin-bmpi
is off-limits for edits per existing user memory; this cycle confirms
it is *required reading* for legacy-pattern audit when reviewer comments
imply a template the agent hasn't seen. Update path captured in this
project's `feedback.md`.

**Cross-phase observation — P3 (zero duplication) in spec-driven cycles.**
The principles-md P3 rule is "3+ occurrences require extraction". On
this cycle, P3 was triggered by an *incomplete* extraction: the lifted
helper exists, but two pre-existing duplicates were not deleted. P3's
"Review check" wording ("scan the diff for repeated structural patterns")
should be extended: also check that named-for-deletion duplicates from
the task scope actually got deleted. A delete-failure is harder to spot
than a copy-paste because the diff doesn't show the delete that didn't
happen.

**Cross-references:**
`.loom/csd-717-swift-mapper-pr-feedback/{review,feedback,develop-log}.md`;
`/Volumes/My Shared Files/repo/aper/aper-interfaces` commits `e757f3d` ..
`b92efa7` on `CSD-717-clean`.

## 2026-05-13 - sidebar-chat-titles - Review PASS with one MINOR

Review audit of the eight-task graph against intent, design, plan, and
75 / 75 test evidence. User had already approved at the Build gate and
requested lifecycle closure.

**Disposition.** PASS. 0 blocker / 0 major / 1 minor / 1 note.

**Finding M-1 (MINOR).** `ui/apps/server/src/routes/chats.ts:251`
introduced a comment `// empty-after-trim collapses to null per ADR-6.`
Production code should not reference Loom artifacts (per user-memory
`feedback_comment_style.md`). The rule was honoured everywhere else in
this PR (LiveSidebar.tsx, ChatContextMenu.tsx changes, decorator,
sidebar route, web api). One-line drift; ships as a follow-up nit.

**N-1 (NOTE).** Pre-existing artifact references in untouched code
(`lib/api.ts` US-001/US-003/T-006 banners; `ChatContextMenu.tsx`
ADR-007). `git diff` confirms not introduced by this work — out of
scope; track separately if retroactive enforcement is wanted.

**Cross-phase observation — Review check vs. comment-style memory.**
The principles.md P4 review check catches `legacy*` / `*V1` /
commented-out code but does NOT explicitly catch artifact-ID leaks in
comments. The user-memory rule (no `T-NNN` / `US-NNN` / `Q-NNN` /
`ADR-NN` in production code) is enforced today by the Review Audit
Agent reading the user-memory snippet, not by a principle. Worth
considering whether to lift the comment-style rule into principles.md
as a P2-style "naming/convention" item so it's enforced by every
code-touching subagent rather than only at Review-time. The Build
Task Builder has the same memory access, but a written principle would
be a stronger guardrail.

**Cross-phase observation — ADR validation in tests.** ADR-7 (fork
drops custom_name) was specifically called out in the dispatch as
something to verify was actually tested, not just claimed. The
`chats-route-fork.test.ts` "forked chat is decorated and drops the
source's custom_name to null" test does exactly the right thing:
sets custom_name on the source, forks, asserts null on the fork's
response body. Worth keeping as a pattern — any ADR whose decision
flips an observable wire shape should land with a positive-and-
negative-evidence test (source has X, fork has null) rather than just
a positive-shape test (fork has the right shape).

**Cross-references:**
`.loom/sidebar-chat-titles/{review,feedback,develop-log}.md`;
`.loom/sidebar-chat-titles/test-report.md`;
`.loom/sidebar-chat-titles/tasks/T-001..T-008.done.md`.

## 2026-05-14 - composer-t3code-triggers - verification-env mismatch surfaced at Build pre-flight

Plan originally specified `node-test` (vitest static-source contract) as the verification environment. Build pre-flight discovered baseline `npm test` was 32 files / 372 tests red repo-wide because the test helpers resolve paths via `new URL("../...", import.meta.url).pathname`, which URL-encodes the `/Volumes/My Shared Files/` mount as `/Volumes/My%20Shared%20Files/`; `readFileSync` then ENOENTs. Plan was re-run mid-Build to switch to `cli-shell` (`tsc --noEmit` + `vite build` + per-task `grep`). Cross-project applicability: any Loom project running under a mounted-share path will hit this. The fix lives outside this project's scope (touches test helpers across the repo); the workaround is to pick `cli-shell` at Plan time.

## 2026-05-14 - composer-t3code-triggers - keyboard contract lost in Lexical swap (Review blocker)

The Lexical-migrated composer dropped the textarea's `onKeyDown` handler covering ArrowUp/ArrowDown menu nav, Enter/Tab accept, Escape dismiss latch, and bare Enter to submit. Design.md §"Keyboard contract" and ADR-006 prescribed a `ComposerKeyboardPlugin` registering five `KEY_*_COMMAND`s inside `ComposerEditor` to bubble `ComposerKeyIntent`s to the shell; that plugin was never implemented. `ComposerEditor` declares an `onSubmit` prop and a `focus()` ref method but neither is wired. The cli-shell gates (`tsc --noEmit` + `vite build` + grep) caught zero of this — the unused prop type-checks fine, the no-op method type-checks fine. The five smoke rounds chased visual issues but never re-exercised the keyboard contract that the deleted textarea owned, so the regression escaped the entire build. Surfaced as Blocker 1 in `review.md`. Process learning: when a migration replaces a wired event handler (textarea `onKeyDown`) with a framework-mediated equivalent (Lexical command registry), an explicit per-AC keyboard verification step needs to live somewhere — either in the per-task test sketch (impossible under cli-shell), or in the T-010 HITL checklist with one walk-through per key listed (was present, but the user verified visual / serialisation acceptance and didn't enumerate keyboard ACs individually).

