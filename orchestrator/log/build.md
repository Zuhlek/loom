# Build Log

## 2026-05-11 - loom-ui-phase-update - bunx-tsc-artifact-registry-fallback

Build noted that `bunx tsc --noEmit -p ui/apps/web` (the recipe in
`tests.md`) failed with an artifact-registry 404 in this environment;
the fallback was to invoke `./ui/node_modules/.bin/tsc` directly. Worth
documenting in the tooling contract so future Build phases don't lose
time rediscovering this. Recommend `tests.md` or the loom type docs
record a "if `bunx` registry is unreachable, fall back to the local
node_modules bin" line. The fallback worked cleanly — no other tooling
brittleness surfaced.

## 2026-05-11 - loom-ui-phase-update - server-tsc-error-baseline-diffing

Build documented a useful technique for working in a codebase with a
pre-existing TypeScript error baseline: rather than asserting "tsc
exits 0 after my edit," `git stash` the change, snapshot the error
count (67), apply the change, snapshot again, and assert the **delta is
zero**. This sidesteps a brittle "must clear all errors" gate that
would block legitimate work. Worth promoting to the build contract as
"when the project has a non-zero error baseline, gate on delta not
absolute."

## 2026-05-11 - phase-validators - build-7-task-dag-first-try-green

Build's task-builders implemented this in 7 parallel/sequential
subagent dispatches with no failures across all 91 acceptance gates —
every task green on attempt 1. The factors that produced this:

- `design.md` specified verbatim replacement text for every surface
  edit (SKILL.md / contract.md / README.md), and verbatim section
  content for every Idea-validator stanza to copy.
- `tests.md` specified the exact grep / `rg` / `test -f` assertion
  for every gate, so the Build executor had no judgment calls to
  make on what counts as PASS.
- The Plan slicing was per-validator-file + per-edited-file with no
  cross-file coupling; T-001 / T-002 / T-003 are sibling parallel
  tasks, and T-004 / T-005 / T-006 each touch one file each.
- The verification harness was pure `cli-shell` — no Node, no
  browser, no Python — so the Build executor's environment had zero
  setup friction.

Pattern to log: "when Design specifies verbatim text and Plan slices
one-file-per-task, Build becomes mechanical." Reusable shape for
future small refactors that are mostly docs / orchestrator
material. Worth holding up as a reference for "what shipping clean
on first attempt looks like."


## 2026-05-12 - chat-ui-parity - blocked-on-subagent-dispatch-harness

Build Coordinator dispatched into a CLI/agent context that lacks a Task
subagent primitive. `agent.md` Work-Loop step 3 requires the Coordinator
to dispatch a fresh task-builder subagent per ready task and explicitly
forbids the Coordinator from implementing task scope itself:

> "The Coordinator MUST NOT implement task scope itself; per-task
> implementation work is exclusively the task-builder's responsibility,
> executed in its own fresh context per the framework's vertical-slice
> contract."

This environment exposes only direct Read/Write/Edit/Bash tools — no
Task / Agent invocation tool, no skill that proxies one. The
verification-environment pre-flight is fine (`node-test` available for
T-001..T-010; T-011 HITL is expected to remain a hand-off). The
mismatch is the **dispatch harness itself**, not the per-task
verification harness.

Surfaced as a `blocked` return at the Build→Review gate so the
orchestrator can re-dispatch the Coordinator in an environment that
provides a Task primitive, or so a human can adjust the framework's
expectation. No board mutations land; no repository code edited; no
locks held.

Reusable signal: when the harness can run `node-test` AC verification
but cannot dispatch subagents, Build's vertical-slice contract cannot
be satisfied. Either (a) the orchestrator should provide a Task
primitive in every Build dispatch, or (b) agent.md should add a
fallback clause for "single-agent Build" with an explicit per-task
context-reset discipline.


## 2026-05-12 - chat-ui-parity - T-001 - green

**Task:** T-001 `tasks-update` typed end-to-end (US-009).

Closed the last untyped envelope-write path in the server. Added
`TasksUpdateFrame` to `ServerFrame` in `ui/apps/server/src/chat-protocol/frames.ts`,
lifted the shared `Task` interface into `chat-protocol/messages.ts` (re-exported
from the bridge), and added a typed `serializeServerFrame(frame: ServerFrame): string`
helper. Replaced the inline `JSON.stringify({ kind: "tasks-update", … })` block
in `http-ws-server.ts` with a typed-frame-through-helper call.

Lock → Red → Implement → Green → Done discipline:
- Red: `serializeServerFrame` stubbed to return `"__STUB__"`; two runtime
  tests fail with `SyntaxError` from `JSON.parse(wire)`. Type-level red
  confirmed via `tsc --noEmit` showing `TasksUpdateFrame` not assignable to
  `ServerFrame`.
- Implement: added the variant to the union, implemented the helper as
  `JSON.stringify(frame)`, and wired the http-ws-server emission site.
- Green: 3/3 new tests pass; full `apps/server` suite 17/17 files / 104/104
  tests pass. No new TS errors.

Reusable signal: for wire-type drift bugs where the web side already matches
the runtime payload, the smallest honest red is a sentinel-returning stub
helper so `JSON.parse` itself throws. Avoids the temptation to call a
compile-only check 'red' (it isn't — runtime assertion required).

## 2026-05-12 - chat-ui-parity - T-009 - shiki-marked-shiki-lazy-grammar-subset

T-009 added Shiki syntax highlighting to `ChatMarkdown.tsx` via
`marked-shiki`. Three signals worth promoting to the build contract /
type-docs for future tasks that wire Shiki (or a similarly bundle-
heavy dependency):

1. **Default `shiki` top-level import is a bundle trap.** Importing
   `createHighlighter` from `shiki` pulls in `bundle-full.mjs` which
   references every grammar Shiki ships. Vite then code-splits each
   reference into its own chunk — the first build of T-009 produced
   ~50 grammar chunks (~22 MB on disk, dozens of MB unzipped). The
   correct shape for a curated subset is `shiki/core` +
   `createJavaScriptRegexEngine` (no WASM) + per-language dynamic
   imports from `shiki/langs/<name>.mjs`. The pnpm install layout
   keeps `@shikijs/*` scoped packages invisible to the importing
   workspace, so the `shiki/langs/<name>.mjs` re-export is the
   workspace-friendly path even when documentation suggests
   `@shikijs/langs/<name>`.

2. **`marked-shiki` forces `async: true` on `marked.parse`.** The
   marked extension sets `async: true` in its `MarkedExtension` so the
   `walkTokens` hook can await the user `highlight` callback. Any code
   that previously called `marked.parse(text, { async: false })` must
   either pre-resolve the promise via state (the pattern used in
   `ChatMarkdown.tsx`: `useEffect` + `useState`) or migrate to a fully
   async render. Worth flagging in the wire-contract type docs for
   the chat protocol: marked-shiki composes safely with marked but
   the sync contract is gone.

3. **Bundle-budget escape hatches need to be pre-registered, not
   discovered.** Design ADR-005 already named the escape ("if cost
   exceeds 100 KB gzipped, drop HTML and CSS"); when the actual
   aggregate landed at ~113 KB the decision was already framed. This
   is what 'pre-registered fallback in Design' buys at Build time —
   no need to re-litigate at the gate, just record the data and
   forward to the gating task (T-011 here). Worth promoting:
   bundle-cost ADRs should always carry a concrete escape clause
   keyed to a numeric threshold.

T-009 itself was green on attempt 1 (one one-line docstring tweak
between failed and passing runs to avoid a self-test false positive
on `/html:\s*true/` matching an explanatory comment). All five
"done" criteria satisfied: tests green, test-log has red+green
output, done.md exists with `status: green`, both logs written, lock
released.

## 2026-05-12 — build-task T-004 (chat-ui-parity)

Composer permission-mode + queue-priority controls. Status: green,
1 attempt. Acceptance criteria US-004 AC1–AC4 satisfied. Touched
6 source files (server: `frames.ts`, `claude-session-bridge.ts`,
`http-ws-server.ts`; web: `chat-types.ts`, `ChatComposer.tsx`,
`live-chat.tsx`) + 2 new test files
(`apps/server/test/frames-permission-mode.test.ts`,
`apps/web/test/composer-controls.test.ts`).

Wire shape: extended ClientFrame union with `PermissionModeSetFrame`;
extended `UserTurnFrame.body` with optional `priority?: "now" |
"next" | "later"` (matches SDK enum exactly per Design ADR-004 — no
translation table; composer UI displays "normal" → wire "now",
"next" → wire "next"). New `WirePermissionMode` exports
`"default" | "plan" | "acceptEdits" | "bypassPermissions"` matching
the four modes US-004 AC1 enumerates.

Bridge: `setPermissionMode(chatId, mode)` forwards directly to
`Query.setPermissionMode(mode)` (no debounce per ADR-004), surfaces
SDK errors as session-scoped `system-notice` per Design
`## Failure modes`. `submitUserTurnWithPriority(chatId, text,
priority)` sets `priority` on the SDKUserMessage; the bridge's
`UserMessageQueue` is NOT reordered (SDK-side priority only per
ADR-004). Legacy `submitUserTurn` is now a thin wrapper that passes
`"now"`. Added `__test__installStubSession` helper so unit tests can
inject a fake Query handle without spawning the SDK.

Web component: ChatComposer renders the permission-mode `<select>`
inline immediately right of the "claude" label (always visible per
US-004 AC1), the queue-priority `<select>` only when `isRunning`
(per US-004 AC3 + Plan-time decision in T-004.md). NO model picker
added (ADR-002 carve-out preserved). `isInterrupted` prop added to
lock the API for T-005 with a minimal pill placeholder.

Tests: red phase produced 15 runtime assertion failures, green phase
produced 20 passes. Full suites: server 112/112 green; web 32/33
(1 pre-existing baseline failure unrelated to T-004). `pnpm tsc
--noEmit` clean on web; server zero new errors above baseline noise.

Plan-time persistence note: did NOT add the optional
`MetadataStore.chats.setPermissionMode` helper called out as "may be
missing" in T-004.md. The in-session SDK call satisfies AC2 and live
smoke flow #7. Drain-survival is a future task.

## 2026-05-12 — build-task T-002 — green

AskUserQuestion picker end-to-end (US-001). 8 files touched: 4 server
(`frames.ts`, `http-ws-server.ts`, `claude-session-bridge.ts`,
`test/frames-question-response.test.ts`) + 4 web (`chat-types.ts`,
`AskUserQuestionPicker.tsx`, `live-chat.tsx`,
`test/ask-user-question-picker.test.ts`).

Wire shape: `question-response.body` is now
`{ id: string; answers: string[]; otherText?: string }` (was
`{ choice, freeform? }`). Multi-select sends length ≥ 1; the "Other"
escape hatch surfaces in `answers` via the sentinel `"__freeform__"`
and the typed body rides on `otherText`. Mirror landed on both
`apps/server/src/chat-protocol/frames.ts` and
`apps/web/src/lib/chat-types.ts` in the same diff per the wire-mirror
constraint.

Bridge: `handleCanUseTool` branches on `toolName === "AskUserQuestion"`
to a new private `handleAskUserQuestion` that parses the question +
options + multiSelect defensively, stashes the SDK's `resolve` closure
on `session.pendingQuestion`, and broadcasts a typed
`pending-question` ServerFrame. `respondToQuestion(chatId, id,
{ answers, otherText? })` resolves the stashed promise with
`behavior: "allow"` + `updatedInput: { answers, otherText? }` per
Design — the SDK delivers the answer back to Claude through
`updatedInput`. Stale-id requests dropped silently; abort cleans up
with deny. Snapshot frame now hydrates `pendingQuestion` so re-attach
preserves in-flight questions.

http-ws-server: new `question-response` envelope handler validates
chat-id + id + string-only `answers` array, defaults `otherText` to
undefined when missing, forwards to `bridge.respondToQuestion`.

Web component: `AskUserQuestionPicker.tsx` rewritten to support
single-select (radio) + multi-select (checkbox) + an always-present
"Other" row. Selection model is `string[]` to share one submit path.
Backward-compatible — the legacy `routes/chat.tsx` demo still works
because it passes loose `question`/`options` props without an
`onSubmit` handler. `live-chat.tsx` imports the picker, renders it
gated on `state.pendingQuestion` next to the existing
`pendingPermission` branch, and emits `question-response` on submit.

Tests: red phase produced 16 runtime assertion failures (6 server +
10 web). Green phase produced 24 passes (11 server + 13 web). Full
repo suite: 168/169 (the one failure is the pre-existing
`loom-view-live.test.ts` baseline noted in T-001/T-004). `pnpm tsc
--noEmit` clean on web; server zero new errors above the standing
TS5097 baseline.

## 2026-05-12 — build-task T-006 — green

ToolResultMedia (US-006). 7 files touched: 3 server
(`chat-protocol/messages.ts`, `process-manager/claude-session-bridge.ts`,
`test/bridge-image-flatten.test.ts`) + 4 web (`lib/chat-types.ts`,
`components/chat/ToolResultMedia.tsx`, `components/chat/ToolUseCard.tsx`,
`test/tool-result-media.test.ts`).

Wire shape: `ToolResultSummary` gains an optional
`images?: ToolResultImage[]` field per Design ADR-007.
`ToolResultImage = { mediaType: string; dataB64: string; alt?: string }`.
Mirror landed on both `apps/server/src/chat-protocol/messages.ts`
and `apps/web/src/lib/chat-types.ts` in the same diff per the wire-
mirror constraint.

Bridge: `flattenResultText` renamed to `flattenResultContent` and
expanded to return `{ text, images? }`. It now walks the SDK tool_result
content array for `{ type: "image", source: { type: "base64",
media_type, data } }` blocks and accumulates them into the `images`
array. Text blocks still flatten into the joined `text` digest.
`onUserMessage` writes the returned `images` onto `target.result`
when non-empty; legacy text-only results leave the field absent
(back-compat). Added `__test__handleSdkMessage` to expose the
private dispatch path for the bridge image-flatten unit tests.

Web component: `ToolResultMedia.tsx` ships ALL THREE variants in one
phase per ADR-003 — single inline + click-to-expand, multi-image
thumbnail strip, focus-trapped lightbox. Image transport is data
URLs end-to-end per ADR-006 (`data:${mediaType};base64,${dataB64}`);
NO blob URLs. The lightbox is an internal `MediaLightbox`
component (same file) rendered via `react-dom` `createPortal` to
`document.body` at z-index 1000. Focus-trap is an inline ~40-line
implementation: saves & restores `document.activeElement`, seeds
focus on the close button, traps `Tab` / `Shift+Tab` to cycle
focusable buttons inside the overlay. Dismiss on Escape, backdrop
click (only when the click target IS the overlay, not a child),
or the explicit `×` close button. Multi-image mode adds prev/next
arrow buttons, left/right arrow-key navigation, and a bottom
thumbnail strip with `aria-current` on the active item. `<img>`
`onError` flips a state flag to render an "image unavailable"
placeholder cell (US-006 AC5).

ToolUseCard: imports `ToolResultMedia`; the `hasResult` predicate
now ORs `hasText` and `hasImages` so image-only results still expand;
the existing text `<pre>` and the new `<ToolResultMedia>` render
side-by-side inside the disclosed result body.

Tests: red phase produced 13 runtime assertion failures (across one
server file with 5 tests and one web file with 16 tests; 8 passed at
red because they covered type-mirror existence and the "no blob URL"
negative which the stubbed empty component trivially satisfied).
Green phase: 21 / 21 passes. Full repo suite: 189/190 (the one
failure is the pre-existing `loom-view-live.test.ts` baseline noted
in T-001/T-002/T-004/T-009 — verified identically failing before
this change via `git stash`). `pnpm tsc --noEmit` clean on web;
server has zero new errors above the standing baseline (TS5097
`.ts`-extension imports + `Cannot find module 'ws'` +
`raw` implicit-any + `Headers.entries` missing — all pre-existing).

ADR alignment:
- ADR-003: shipped all three variants in one phase; no library dep
  (focus-trap inline ~40 lines).
- ADR-006: data-URL transport end-to-end; no blob URLs, no server
  route for image bytes.
- ADR-007: `ToolResultSummary.images?` extended (not a new ChatItem
  kind); text-only results back-compat.

Deviation: the brief's `files-likely-touched` listed
`MediaLightbox.tsx` as a separate file. I folded the lightbox into
`ToolResultMedia.tsx` as an internal component — the two share state
tightly (images + activeIndex) and there is no second caller. A
future iteration that needs a generic modal portal can extract then.
Recorded in done.md notes.

## 2026-05-12 — build-task T-008 — green (chat-ui-parity)

Sticky error banner (US-008). Web-only; 3 files touched: NEW
`ui/apps/web/src/components/chat/ChatErrorBanner.tsx`, edited
`ui/apps/web/src/routes/live-chat.tsx`, NEW
`ui/apps/web/test/sticky-error-banner.test.ts`.

Reducer shape change: `ChatState.lastError: string | undefined`
replaced by `ChatState.error: { message: string; dismissed: boolean } | null`.
New `dismiss-error` and `error-frame` actions on the discriminated
union. The `snapshot` reducer branch now performs a novelty check
against `state.error?.message` and preserves `state.error` verbatim
when the snapshot's `body.lastError` matches or is absent — fixing
the bug at the core of US-008 (the old branch unconditionally
overwrote `lastError`, clobbering visible errors). The `turn-state`
branch (and the new `error-frame` branch) reset `dismissed: false`
only when the message changes, matching the Design state machine's
same-message-preserves-dismiss rule. The server `error` frame now
dispatches `error-frame` in addition to the legacy `console.warn`.

Render: inline `state.lastError && turnState === "error"` div
replaced by `state.error && !state.error.dismissed
  ? <ChatErrorBanner message=... onDismiss=... />`. The
`turnState === "error"` gating is intentionally dropped — Design
says the banner outlives the error state until explicit dismiss.

ChatErrorBanner: ~40-line component with `message` + `onDismiss`
props, `×` close button (`aria-label="Dismiss"`,
`data-testid="chat-error-banner"`). No `chat-types.ts` change — the
wire shape (`ChatSnapshot.lastError?: string`) is the right
boundary; the new `error: { message; dismissed }` shape is a
frontend-only reducer concept per the task brief.

Tests: red phase 9 runtime assertion failures (no compile errors —
legacy `lastError` shape is still valid TS; static-source regexes
return false). Green: 9/9 pass. Full web suite 70/71 (the one
failure is the pre-existing `loom-view-live.test.ts` baseline noted
in T-001/T-002/T-004/T-006/T-009 — verified identically failing
before this change via `git stash`). `pnpm tsc --noEmit` clean on
apps/web.

Design state-machine alignment: the four transitions land verbatim
(`null → { E, false }`, `{ E, false } → { E, true }`,
`{ E, true } → { E', false }` for E'≠E,
`{ E, x } → { E, x }` on matching/absent snapshot). Banner-renders-iff
invariant `state.error && !state.error.dismissed` matches Design.

One-attempt green; well within the 3-attempt cap.

## 2026-05-12 — task-builder — T-003 green

T-003 Interactive ProposedPlanCard end-to-end — green on first
attempt.

Server: new `PlanProposedItem` ChatItem kind in messages.ts; new
`PlanAcceptFrame` / `PlanRejectFrame` in frames.ts; bridge detects
`ExitPlanMode` tool_use in `onAssistant` and emits a `plan-proposed`
item via the existing `item-append` path. Empty-body guard appends a
`system-notice` per Design `## Failure modes`. Added
`acceptPlanProposal` (setPermissionMode → execute user-turn → status
flip), `rejectPlanProposal` (reconsider user-turn → status flip;
permission mode untouched), and a private `handlePlanProposal`.
http-ws-server routes the two new frames to the bridge methods
(validate chat-id + body.planId; fire-and-forget per ADR-004).

Web: new `ProposedPlanCard.tsx` (~135 LOC) renders plan body via
`ChatMarkdown` with Accept/Reject buttons; disabled when
`status !== "pending"`; status pill ("Accepted"/"Rejected") in the
header. `MessagesTimeline.tsx` grew a `plan-proposed` switch branch +
threaded handler props. `live-chat.tsx` emits typed `plan-accept` /
`plan-reject` ClientFrames on the button handlers. `chat-types.ts`
mirrors PlanProposedItem + both ClientFrames byte-for-byte.

Wire-frame channel decision: used dedicated `plan-accept` /
`plan-reject` ClientFrames per the Build dispatch's explicit
instruction (divergence from T-003.md's text-correlation suggestion).
T-003.md's "Build note" left the choice open; this approach makes
server-side handling explicit and avoids text-matching collisions.

ADR alignment:
- ADR-001: card visible unconditionally; no pipeline-phase gating;
  no feed-back into loom's plan.md.
- ADR-004: setPermissionMode NOT debounced; Accept does NOT
  auto-submit composer draft; bridge UserMessageQueue stays FIFO.

Tests: 8 server (`bridge-plan-proposed.test.ts`) + 10 web
(`proposed-plan-card.test.ts`); all green. Red phase: 3 server +
8 web runtime-assertion failures (NOT compile errors — stubs land
first per task-builder.md). Green on first attempt.

Full suite after: 28/29 test files passing, 216/217 tests pass.
The single failure is the pre-existing `loom-view-live.test.ts`
baseline (independent of this change).

`pnpm tsc --noEmit` apps/web clean; apps/server no new errors over
baseline.

Files changed:
- ui/apps/server/src/chat-protocol/messages.ts
- ui/apps/server/src/chat-protocol/frames.ts
- ui/apps/server/src/process-manager/claude-session-bridge.ts
- ui/apps/server/src/http-ws-server.ts
- ui/apps/server/test/bridge-plan-proposed.test.ts (new)
- ui/apps/web/src/lib/chat-types.ts
- ui/apps/web/src/components/chat/ProposedPlanCard.tsx (new)
- ui/apps/web/src/components/chat/MessagesTimeline.tsx
- ui/apps/web/src/routes/live-chat.tsx
- ui/apps/web/test/proposed-plan-card.test.ts (new)

## 2026-05-12 — build-task T-005 — green (chat-ui-parity)

Interrupted state pill + implicit resume surface (US-005).
Visibility-only fix: replaces the muted placeholder span shipped
by T-004 with the real amber "Interrupted" pill adjacent to the
Stop/Send control. `role="status"` live region + `aria-label`
carrying the resume-affordance copy ("Send a message to continue
from where Claude paused.").

No server-side, bridge, frames, or chat-types edit. No
turnState-machine change. No reducer change in `live-chat.tsx`
— the `isInterrupted={state.turnState === "interrupted"}` wiring
landed correctly in T-004 and is only verified here.

Design alignment:
- turnState machine unchanged; pill surfaces existing
  `"interrupted"` state visually.
- Composer policy split — `"interrupted"` falls in `"ready"`
  bucket, verified by AC2 static-source check on every
  `composer(?:Disabled|Mode|Reason)` line.
- Implicit re-prime path (Q06): SDK consumes the next user
  message from `UserMessageQueue`. End-to-end verification
  rolled into T-011 flow 6.

a11y: `role="status"` (polite live region, not `alert` — the
interrupted state is intentional, not an error). `aria-label`
carries the state + affordance copy; `title` mirrors it for
hover.

Color: amber 700 / amber 100 via
`var(--warning, #b45309)` / `var(--warning-foreground, #fef3c7)`
with Tailwind utility fallback.

Tests: red phase produced 3 runtime-assertion failures
(warning-color, ARIA, resume-affordance). Compile clean.
Green phase: 9 / 9 passes on first attempt.

Full suite after: 29/30 test files passing, 225/226 tests pass.
Lone failure is the pre-existing `loom-view-live.test.ts`
baseline (independent of this change; this task did not touch
`App.tsx` or routing).

`pnpm tsc --noEmit` apps/web clean.

Files changed:
- ui/apps/web/src/components/chat/ChatComposer.tsx
- ui/apps/web/test/interrupted-pill.test.ts (new)

## 2026-05-12 — build-task T-007 (chat-ui-parity) — green

Composer policy split per Q08 / US-007: `composerMode: "ready" |
"queue" | "blocked"` selector replaces the legacy boolean. Queue
mode keeps the composer enabled and pushes submits with
`priority: "next"` by default; blocked mode hard-disables (existing
permission-card / question-picker behavior). No bridge / server
edits — wire shape was already sufficient (T-004's optional
`priority` on `user-turn`).

Red: 14 / 18 runtime-assertion failures (selector non-existent,
ComposerMode type missing, mode-mapping regex absent). Green:
18 / 18 on first implementation pass. Full suite 243/244 (one
pre-existing `loom-view-live.test.ts` baseline).

ADRs maintained: ADR-004 (queue-priority SDK-side only; bridge
UserMessageQueue stays FIFO), ADR-002 (no control-panel
generalisation; modes live inline in ChatComposer.tsx). T-005's
interrupted-pill test continues to pass — preserved the literal
`title="Send (Enter)"` substring in the ready-mode Send button
so the placement-grep test still finds it.

`pnpm tsc --noEmit` apps/web: zero errors.

Files changed:
- ui/apps/web/src/routes/live-chat.tsx
- ui/apps/web/src/components/chat/ChatComposer.tsx
- ui/apps/web/test/queued-input-policy.test.ts (new)
- **T-010 chat-ui-parity (green, 2026-05-12T10:00:00Z)** — Wire-mirror drift type-guard test landed. 1 file added: `ui/apps/server/test/wire-mirror-drift.test.ts`. No drift today.

## 2026-05-12 - weave-phase-folder-restructure - T-001 cross-cutting paths landed

Cross-cutting task that gates every per-phase task. Renamed `orchestrator/weave/contract.md` → `signature.md` via `git mv` (preserves rename in git log --follow). Rewrote SKILL.md Load Order to read `phase.md` + `phase.signature.md` instead of `agent.md` + `*.return.schema.yaml`. Added explicit "Dispatch concatenation" subsection to Phase Cycle 3 with the body-first / `\n\n---\n\n` / signature-second rule (ADR D-04). Added "Schema-compliance extraction" subsection to Phase Cycle 3c spelling out how to locate the fenced `yaml` block under `### Return block` (Interface 3). Updated `methods/recovery.md` and `orchestrator/README.md` to match. Hook unchanged per Q05/D-05. No commits; HEAD unchanged.
- **T-011 chat-ui-parity (green, 2026-05-12T10:30:00Z, HITL)** — Live smoke 7/7. Build phase fully closed.

## 2026-05-12 - weave-phase-folder-restructure - 7-task DAG green on first attempt

Autonomous Build completed the structural restructure in 7 tasks with zero rerun, zero failed, zero hitl-block. T-001 (cross-cutting orchestrator paths + top-level `contract.md` → `signature.md` rename) gated T-002..T-006 (per-phase restructures, independent), which gated T-007 (global verification + working-tree-change-report).

9 renames via `git mv` registered as `R` lines in `git status --porcelain orchestrator/`:
- 1 top-level: `weave/contract.md` → `weave/signature.md`
- 5 phase agents: `phases/<phase>/agent.md` → `phases/<phase>/phase.md`
- 3 Build methods: `methods/{task-builder,smoke-test,mutation-test}.md` → `methods/{task,smoke,mutation}.md`

12 new `*.signature.md` files (5 phase + 4 QC + 3 Build methods). 21 deletions (5 contract.md + 5 artifact.md + 5 phase-agent schemas + 4 QC schemas + 3 Build-method schemas). All Layer A/B/C/D verification assertions pass globally; the SKILL.md concatenation rule (body-first / `\n\n---\n\n` / signature-second) and schema-source extraction rule are landed.

Smoke gate skipped (project deliverable is markdown structure; cli-shell Layer A/B/C/D assertions cover the actual verification surface). Mutation gate skipped (`tests.md` declares `Mutation Testing: no` — no logic/security/money/data-integrity surface to mutate-test).

Predecessor-undo discipline: every file the predecessor `weave-framework-hygiene` project had edited (SKILL.md, contract.md, recovery.md, README.md, all 5 phase agent.md, 3 Build method bodies, 4 quality-check.md) was consolidated to the final two-files-per-callable shape rather than additively edited. Predecessor's obsolete additions (`*.return.schema.yaml` sibling-file references, Load-Order step 6 loading the schema YAML, the "Phase return schema" table row) removed; predecessor's surviving terminology updates (Validator → Quality Check) preserved.

One out-of-scope edit: `phases/spec/methods/grilling.md` (2 inline `agent.md` → `phase.md` cross-reference rewrites) to satisfy T-007's Layer D global ref-sweep. ADR D-06 keeps reference-doc files exempt from the two-files convention itself, but their cross-references to the renamed siblings still needed updating. Recorded in T-007's done.md `out-of-scope-edits`.

Hook (`orchestrator/hooks/validate-subagent-output.py`) intentionally untouched per Q05/D-05. HEAD unchanged from start of run; no commits made by Build. The user inspects the working tree at the Review gate and owns the final commit.

## 2026-05-12 - chat-ui-parity - lockfile-pid-mismatch-manual-rm

`orchestrator/lib/locks.sh release-task` checks PID against the
holder PID before unlinking the lockfile. Each task-builder subagent
runs in a fresh Bash subshell whose PID never matches the PID stored
at acquire time, so `release-task` consistently failed across every
T-NNN in this project. Every task-builder noted it in done.md and
resorted to manual `rm -rf .loom/<project>/.locks/T-NNN.lock`.
Known limitation; not a per-task issue. Recommended fix: drop the
PID check OR record the acquiring subshell's PID at acquire time
(not the shell's). Worth fixing in locks.sh before the next loom
Build — repeatedly burning context on a known-good workaround is
a hidden tax on every task-builder.

## 2026-05-12 - chat-ui-parity - t-010-partial-completion-coordinator-wrap-up

T-010's task-builder subagent hit an account-level rate-limit after
writing the test file but before completing the
Lock→Red→Implement→Green→Done loop. The Build Coordinator
completed the wrap-up plumbing manually: verified the test was
green, verified `tsc --noEmit` clean for the guard file, wrote
`T-010.done.md`, wrote the test-log, released the lock, dual-wrote
the log entries. **No framework principle was violated:** the
actual code (the `wire-mirror-drift.test.ts` file) was the
subagent's product, written in a fresh context; the Coordinator's
contribution was administrative closure — its role in the work
loop. Reusable pattern: when a task-builder hits an unrecoverable
transport / rate-limit issue mid-task, the Coordinator can salvage
the work by completing only the administrative wrap-up (done.md,
test-log, lock release, log entries) and MUST NOT re-do the
implementation work. Project-level Review catches any drift if
the salvage was incomplete.

## 2026-05-12 - weave-phase-folder-restructure - autonomous-build first-attempt-green ceiling

Build executed 7/7 tasks `green` on first attempt with zero rerun,
zero `failed`, zero `hitl-block`. Review's independent re-execution
of Layer A/B/C/D assertions confirmed Build's report — file counts
(5/5/4/4/3/3/1/0), signature shape (canonical heading order +
exactly one `yaml` fence under each `### Return block` across all
12 `*.signature.md`), body cleanliness (no `## Reads` / `## Writes`
/ `## RETURN` across all 12 body files), cross-references zero
matches to deleted paths, `git status` 9 `R` rename entries, HEAD
unchanged. Contributing factors observable from Review side: (1)
deliverable is markdown — verification surface is `find` / `grep` /
`wc` / `git status`, all deterministic; (2) ADR D-07's
cross-cutting-first decomposition meant orchestrator/hook
references landed before any per-phase task ran, foreclosing the
"stale reference" risk; (3) per-task frontmatter
(`files-likely-touched`, `satisfies-stories`) gave task subagents
tight scope; (4) predecessor-undo discipline threaded forward from
Spec → Plan → Build prevented "additively-edited on top of
half-obsolete edits" failure. Reusable cue:
markdown-self-description refactors with cli-shell verification
have a low rerun ceiling — when inputs are well-grounded and
decomposition matches file layout (vertical slices per folder),
first-attempt-green is the expected outcome.

## 2026-05-12 — build-task T-001 (chat-streaming-fixes) — green

T-001 Stable streaming-item identity (`message_start` + paired
`onAssistant`) — green on first implementation attempt.

Bridge: added `currentMessageStartId: string | null` to `ChatSession`
(initialised `null` at both construction sites — live `spawn()` and
the `__test__installStubSession` helper — and explicitly nulled in
`submitUserTurnWithPriority` for symmetry with the state-flow diagram
in design.md). New top-level helper `resolveAssistantItemId(session,
msg)` prefers the scratch id and falls back to `msg.uuid` +
`console.warn` (ADR-003). Reshaped `onPartial` so the event-type
branch fires BEFORE the item lookup: `message_start` captures
`event.message.id` into the scratch and returns; subsequent branches
use the resolver as the assistant-item id. `message_stop` clears the
scratch so the next SDK message in the same turn starts a fresh chain
(US-001 AC-3). Migrated `onAssistant` to key by `msg.message.id` with
`msg.uuid` fallback + warning (ADR-007 paired migration);
`session.toolUseToAssistantId.set(...)` calls now register against
the resolved `id` so the `tool_result` echo path resolves correctly.

ADR alignment:
- ADR-003: `message_start` precedence is contract-guaranteed; AC-5
  fallback retained as audit trail, not graceful-recovery path.
- ADR-007: paired `onAssistant` migration. `msg.uuid` is the SDK-event
  UUID, NOT the same string as `msg.message.id` — coalescing the
  streaming row with the canonical row REQUIRES both sites to key by
  `msg.message.id`.

Constraints honoured:
- No new wire-shape additions. `currentMessageStartId` is
  bridge-internal; never serialised onto any `ServerFrame`, snapshot,
  or `ChatItem`. `messages.ts`, `frames.ts`, `chat-types.ts` untouched.
- `onPartial` switch grows by exactly one branch (`message_start`).
- SDK pin compatibility — reads `event.message.id` on
  `BetaRawMessageStartEvent` per `messages.d.ts:1168-1175`.

Tests: 9 new behaviour-level tests in
`apps/server/test/bridge-partial-streaming.test.ts` modelled on
`bridge-plan-proposed.test.ts`. Covers AC1 (`message_start` id
capture), AC2 (multi-batch coalescing), AC3 (multi-SDK-message turn
shares one `turnId`), AC4 partial-stream regression guard (50 deltas
→ 1 row), AC4 paired migration (canonical message with different
`msg.uuid` coalesces by `message.id`), AC4 paired fallback (missing
`message.id` → `msg.uuid` + warning), AC5 missing-`message_start`
fallback + warning, lifecycle (`message_stop` clears scratch;
`submitUserTurnWithPriority` on a fresh session leaves it `null`).
Red phase: 9/9 runtime-assertion failures (no compile / import
errors — `__test__handleSdkMessage`, `__test__installStubSession`,
and `__test__sessions` were already exposed for T-003/T-006 tests).
Green on first attempt.

Full server suite after: 23 test files, 146 tests, all green.
Pre-existing baseline TS5097 import-extension errors and unrelated
`http-ws-server.ts` errors are unchanged by this diff (no new TS
errors introduced). The single pre-existing failing test
`apps/web/test/loom-view-live.test.ts` is outside the task surface
and unrelated to bridge code.

`bridge-plan-proposed.test.ts` fixtures don't carry `message.id` on
their synthesised `SDKAssistantMessage` objects, so the new ADR-007
fallback warning fires harmlessly on those tests (their pre-existing
assertions still pass — the test-only fixtures simply route through
the documented fallback path).

Files changed:
- ui/apps/server/src/process-manager/claude-session-bridge.ts
- ui/apps/server/test/bridge-partial-streaming.test.ts (new)

## 2026-05-12 — chat-streaming-fixes — build-task T-003 — green

T-003 WorkingChip sibling row + `activeTurnStartedAt` reducer field —
green on first implementation attempt.

Web: new `WorkingChip.tsx` (~95 lines). Self-ticks
`setInterval(1000)` → `nowMs` state; cleans up via `clearInterval`
on unmount. Renders three `animate-pulse` dots (`var(--info)`) +
"Working for {label}". `formatElapsed` mirrors t3code's
`formatWorkingTimer` verbatim (Xs / Xm Ys / Xm / Xh Ym / Xh — ADR-005).

`MessagesTimeline.tsx`: new prop `activeTurnStartedAt: number |
null`; imports the chip; renders it as LAST child of the scroll
container (after `items.map(...)`) gated on `turnState ===
"running" && activeTurnStartedAt != null` (ADR-001). Removed the
legacy inline `turnState === "running"` "Working…" block (formerly
:82-90) AND the inline `blocks.length === 0 && item.streaming`
"Thinking…" placeholder from AssistantRow. The Thinking-placeholder
removal is a documented deviation from T-003.md item 5 / design.md
AssistantRow snippet — the user's task brief for this dispatch
explicitly instructed it ("redundant with the chip and contributed
to bug 1's row spam"), which overrides the plan-time note.

`live-chat.tsx`: new `ChatState.activeTurnStartedAt: number | null`
(initial `null`). `turn-state` branch sets `Date.now()` on
idle→running, preserves on running→running, clears on any
transition out of `"running"`. `snapshot` branch seeds `Date.now()`
when `body.turnState === "running"` (ADR-005 — best-effort given
no-wire-shape constraint); else `null`. MessagesTimeline mount
passes the prop through.

ADR alignment:
- ADR-001: chip is sibling row at bottom of scroll container.
- ADR-002: instant mount/unmount; only the 3 dots animate
  (`animate-pulse`).
- ADR-005: self-ticking `setInterval(1000)`; web-local timestamp;
  snapshot reseeds to `Date.now()`.

Tests: 22 new static-source contract tests in
`apps/web/test/working-chip.test.ts`. Red phase: 22/22
runtime-assertion failures (not compile / not import). Green on
first attempt after a single test-helper refactor (brace-balancing
case-branch extractor replaced an over-eager non-greedy regex).

`pnpm tsc --noEmit` from `ui/apps/web/`: clean.

Files changed:
- ui/apps/web/src/components/chat/WorkingChip.tsx (new)
- ui/apps/web/src/components/chat/MessagesTimeline.tsx
- ui/apps/web/src/routes/live-chat.tsx
- ui/apps/web/test/working-chip.test.ts (new)

Smoke / mutation gate untouched (Build Coordinator's responsibility).

## 2026-05-12 — chat-streaming-fixes — build-task T-002 — green

T-002 Dense-blocks invariant + web null defense (US-002) — green on
first implementation attempt.

Bridge (`apps/server/src/process-manager/claude-session-bridge.ts`):
added top-level helpers `makePlaceholderBlock()` (returns the ADR-004
filler `{ type: "text", text: "", _placeholder: true }`) and
`ensureDense(blocks, targetIdx)`. The `content_block_start` branch in
`onPartial` now calls `ensureDense(aitem.blocks, idx)` BEFORE every
`aitem.blocks[idx] = ...` write so the array stays dense end-to-end
and survives `JSON.stringify` without holes becoming literal `null`s
on the wire. The unknown-block-type fall-through pushes a placeholder
at `idx` when `aitem.blocks.length === idx` (avoids re-introducing a
sparse hole).

Wire-shape extension (paired diff per Spec Constraint — EXTENSION not
ADDITION):
- `apps/server/src/chat-protocol/messages.ts`: `AssistantTextBlock`
  gains an optional `_placeholder?: boolean` field.
- `apps/web/src/lib/chat-types.ts`: mirror of the same field.
- The cross-cutting `wire-mirror-drift.test.ts` `_C_ChatItem` guard
  continues to pass post-diff.

Web (`apps/web/src/components/chat/MessagesTimeline.tsx`):
`AssistantBlock` imported; `AssistantRow`'s render pipeline reshaped
to `.filter(...).map(...)`. Filter predicate drops null / undefined
entries AND `_placeholder === true` entries (ADR-004). `.map`
callback uses `block?.type` on every branch (US-002 AC4 belt-and-
suspenders) and the streaming caret index is computed against the
FILTERED array's `arr.length - 1` (the third map argument) so the
caret cannot land on a placeholder. Unknown block kinds return
`null` rather than throwing (US-002 AC5). T-003's deliberate removal
of the inline "Thinking…" placeholder is preserved.

Tests: 10 new tests across `apps/server/test/bridge-dense-blocks
.test.ts` (5 behaviour-level via `__test__handleSdkMessage`) and
`apps/web/test/assistant-row-null-defense.test.ts` (5 static-source
contract checks). Red phase: 9/9 runtime-assertion failures (no
compile / import failures — `__test__*` helpers already exposed).
Green: 10/10 pass; `wire-mirror-drift.test.ts` still green; full
vitest 285 / 286 (1 pre-existing unrelated failure
`loom-view-live.test.ts:37`); `pnpm tsc --noEmit` from `ui/apps/web`
is clean and `ui/apps/server` shows only pre-existing baseline
errors (TS5097 import-extension noise + http-ws-server module-not-
found, unchanged by this diff).

Files changed:
- ui/apps/server/src/process-manager/claude-session-bridge.ts
- ui/apps/server/src/chat-protocol/messages.ts
- ui/apps/web/src/lib/chat-types.ts
- ui/apps/web/src/components/chat/MessagesTimeline.tsx
- ui/apps/server/test/bridge-dense-blocks.test.ts (new)
- ui/apps/web/test/assistant-row-null-defense.test.ts (new)

Smoke / mutation gate untouched (Build Coordinator's responsibility).
- **T-004 chat-streaming-fixes (green, 2026-05-12T13:00:00Z, HITL)** — 10/10 live smoke; bugs 1 & 2 fixed.

## 2026-05-12 - chat-streaming-fixes - 3/3 AFK tasks green on first attempt with zero rework

T-001, T-002, T-003 all came back green on their first build
attempt. No re-dispatch. No 3-attempt cap exercised. The build
window was ~35 minutes wall-clock from Build-start to AFK-complete
(per pipeline.md history: 12:10 → 12:45 UTC).

Contributing factors observed:
1. Plan pre-resolved 7 "would Build need to ask?" ambiguities
   inline (`plan.md ## Build-simulation result`) — fallback warning
   string format, `currentMessageStartId` init sites, placeholder
   shape, snapshot-reattach behaviour, chip placement, etc. Build
   never stalled to ask.
2. Design's diff-surface annotation
   (`design.md ## System shape` enumerates "Diff surface 1, 1b, 2,
   3" with file:line citations) meant Build knew exactly where
   each task touches the tree — no exploration phase.
3. ADR-007's emergence in Design pre-emptively flagged the paired
   `onAssistant` migration. Without it Build would likely have
   discovered the bug during T-001 unit-test red phase and had to
   re-dispatch or expand scope mid-task.
4. The four task `T-NNN.md` briefs reference Spec ACs and Design
   ADRs by id, not by paraphrase — Build agents could anchor every
   assertion to a specific AC/ADR without re-deriving intent.

Process lesson: zero-rework Build runs aren't luck; they correlate
with explicit pre-resolution of would-stall-Build questions in
Plan AND with Design pre-emptively flagging cross-cut migrations
that the seed didn't name. Reusable cue: `plan.md ## Build-simulation
result` is a high-value section even when it looks repetitive —
each "Plan choice: …" line is a future Build stall averted.

Source: `.loom/chat-streaming-fixes/plan.md` Build-simulation
section + per-task done.md "Attempts: 1" line.

## 2026-05-12 - chat-streaming-fixes - user committed mid-Build (between AFK-complete and HITL-complete)

Two user-initiated commits (`aca4c9b` "remove docs, fix ui
streaming layedr" and `9fc18e5` ".") landed between the AFK-build
complete event (12:45) and the T-004 HITL-complete event (13:00) per
`events.jsonl`. The commits include the load-bearing loom diff
(`WorkingChip.tsx`, `claude-session-bridge.ts`, `MessagesTimeline.tsx`,
`live-chat.tsx`, the four new test files) bundled with unrelated
working-tree state from the parent loom that hadn't been committed
during chat-ui-parity's lifecycle.

This is flagged as `F-MINOR-1` in this loom's `review.md`. The
commits were user-driven (lowercase, untemplated messages), not
agent-driven. The Review-prompt safety check ("No commits / pushes
during Build … same head as before Build") is calibrated against
agent behaviour but matches user behaviour too — which produced a
finding even though nothing harmful happened.

Process lesson: the harness should distinguish agent-initiated from
user-initiated commits when checking the "no commits during Build"
invariant. Users sometimes commit mid-Build to clean up working-tree
drift before opening Review; this is not the failure mode the
safety check was designed to prevent (which is agent auto-commit
short-circuiting the gate). Reusable cue: when Review surfaces
"head moved during Build," distinguish "agent did this" (blocker)
from "user did this" (minor process note). Both deserve a row in
review.md but with different severity routing.

Source: `git log` showing commits between 10:45 UTC AFK-complete
and 11:00 UTC HITL-complete; commits authored as `Zuhlek
<72124667+...>` (the user).
