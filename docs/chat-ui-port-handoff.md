# Chat UI port — t3code mirror handoff

Date: 2026-05-11
Status: Working vertical slice, several feature gaps remaining (see §4).

This document captures the state of the chat-layer rewrite that moved
loom from an xterm.js-backed embedded terminal to a structured chat UI
modeled on t3code's `ChatView` / `MessagesTimeline` / `ChatComposer`.

If you're picking this up cold, read sections 1–3 in order, then jump
to §4 for the punch list.

---

## 1. Decisions taken

Two architectural forks were locked in at the start of the work:

1. **Message source: the Claude Agent SDK
   (`@anthropic-ai/claude-agent-sdk`)**, the same package t3code uses.
   Alternatives were `claude -p --output-format=stream-json` headless
   and JSONL transcript tailing; the SDK was chosen for parity with
   t3code and because it gives us typed streaming events (text deltas,
   `tool_use`, `tool_result`, thinking, results) with native permission
   callbacks.
2. **Frontend depth: "match the feel, keep loom simple."** No
   Zustand-normalized store, no Effect-based RPC, no virtualized list.
   Plain `useReducer` + WebSocket+JSON frames. The deliberate cost is
   that loom won't scale to t3code's history sizes or concurrent-thread
   counts without a follow-up refactor.

Both choices were confirmed by the user via `AskUserQuestion` at the
start of the session.

---

## 2. What was built

### 2.1 Server (apps/server)

| File | Role |
|------|------|
| [`src/chat-protocol/messages.ts`](../ui/apps/server/src/chat-protocol/messages.ts) | Typed `ChatItem` union (`user-message` / `assistant-message` / `system-notice`), `AssistantBlock` (text / thinking / tool_use), `PendingPermission`, `PendingQuestion`, `ChatSnapshot`. Authoritative wire shape — keep in sync with the web mirror. |
| [`src/chat-protocol/frames.ts`](../ui/apps/server/src/chat-protocol/frames.ts) | Typed WebSocket frames (`ClientFrame` / `ServerFrame`). Discriminated by `kind`. |
| [`src/process-manager/claude-session-bridge.ts`](../ui/apps/server/src/process-manager/claude-session-bridge.ts) | The replacement for the old `ChatPtyBridge`. One long-lived `query()` per chat; an unbounded `UserMessageQueue` feeds it. Translates SDK messages → `ChatItem`s, fans server frames to attached WS clients, manages a 30 s drain timer, exposes `attach` / `detach` / `dispose` / `submitUserTurn` / `interrupt` / `respondToPermission`. |
| [`src/http-ws-server.ts`](../ui/apps/server/src/http-ws-server.ts) | WS routing rewritten: `attach` / `detach` / `user-turn` / `interrupt` / `permission-response` (client→server). Server fans `snapshot` / `item-append` / `item-update` / `turn-state` / `pending-permission` / `tasks-update`. |
| [`src/index.ts`](../ui/apps/server/src/index.ts) | Swapped `ChatPtyBridge` → `ClaudeSessionBridge`. Removed `ensureNodePtyHelperExecutable`. `resolveClaudeBin` kept and threaded as `pathToClaudeCodeExecutable` into the SDK. |

**Behavior notes baked into the bridge:**

- **Session ID flow preserved.** First spawn uses `sessionId: chat.session_id`;
  respawn after drain uses `resume: chat.session_id`. The metadata-store
  `inert` flag still gates this.
- **Permission flow.** `canUseTool` stashes a `PendingPermissionState`
  with the SDK's `resolve` function. The WS `permission-response` frame
  resolves it. `remember: true` echoes back the SDK-supplied
  `updatedPermissions` so "Always allow this session" actually works.
- **Tasks side-panel.** No more JSONL tailing — `maybeUpdateTasks`
  walks the items array from the tail looking for the latest
  `TodoWrite` `tool_use`. Same shape as before; existing
  `TasksPanel.tsx` is unmodified.
- **Streaming.** `includePartialMessages: true` is set; the bridge
  applies `content_block_start` / `content_block_delta` /
  `message_stop` events to its in-memory `AssistantMessageItem` and
  emits `item-update` frames. The final canonical `assistant` SDK
  message overwrites the streaming version (`streaming: false`).

### 2.2 Web (apps/web)

| File | Role |
|------|------|
| [`src/lib/chat-types.ts`](../ui/apps/web/src/lib/chat-types.ts) | Hand-maintained mirror of the server's `messages.ts` + `frames.ts`. **Single source of drift risk** — any wire change must land on both sides. |
| [`src/components/chat/MessagesTimeline.tsx`](../ui/apps/web/src/components/chat/MessagesTimeline.tsx) | Renders the ordered `ChatItem[]`. Auto-sticks to bottom unless the user has scrolled away. "Working…" pulse when `turnState === "running"`. |
| [`src/components/chat/ChatMarkdown.tsx`](../ui/apps/web/src/components/chat/ChatMarkdown.tsx) | `marked`-backed renderer with a streaming caret. Trust model: assistant output → `dangerouslySetInnerHTML` from `marked` only (no raw-HTML passthrough). |
| [`src/components/chat/ToolUseCard.tsx`](../ui/apps/web/src/components/chat/ToolUseCard.tsx) | Inline tool-call cell. Status dot, one-line input summary per tool (Read/Edit/Bash/Glob/Grep/TodoWrite/Task/etc.), collapsible result. |
| [`src/components/chat/ChatComposer.tsx`](../ui/apps/web/src/components/chat/ChatComposer.tsx) | Wired: `onSubmit`, Enter sends, Shift+Enter newline, send button replaced by Stop while running, focus restored on send. |
| [`src/components/chat/ChatMessages.tsx`](../ui/apps/web/src/components/chat/ChatMessages.tsx) | Untouched — its `ChatMessage` is reused by `MessagesTimeline`. |
| [`src/routes/live-chat.tsx`](../ui/apps/web/src/routes/live-chat.tsx) | Reducer-driven WS client. `reset` → `snapshot` → `item-append`/`item-update` → `turn-state`/`pending-permission`. Reconnect loop (10× 1 s). Wires the composer's submit / interrupt / permission response. |
| [`src/styles.css`](../ui/apps/web/src/styles.css) | Added `.chat-markdown` styles and `.streaming-caret` animation. |

**Removed (no longer referenced anywhere):**

- `apps/server/src/process-manager/chat-pty-bridge.ts`
- `apps/server/src/process-manager/pty.ts`
- `apps/server/src/process-manager/pty-helper.cjs`
- `apps/server/src/transcript-watcher.ts`
- `apps/server/src/jsonl-tailer.ts`
- Matching tests for the four files above.

**Dependency changes:**

- Added: `@anthropic-ai/claude-agent-sdk` (apps/server).
- Removed: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`
  (apps/web), `node-pty` (root).
- Production bundle: **~700 KB → 321 KB** (gzip 90 KB).

---

## 3. Verified at handoff

- `pnpm tsc --noEmit` clean on both packages (pre-existing
  `TS5097`/`TS2307` noise filtered — they predate this work).
- `pnpm build:web` succeeds.
- `pnpm test`: 114 passing, 1 failing (`loom-view-live.test.ts`).
  **This failure is pre-existing** — verified by `git stash &&
  pnpm test`. It expects a route shape (`path="/loom/:phase?"`) that
  was changed in commit `91c2699` ("update loom detail page for new
  phases") without updating the test.
- Server starts cleanly up to the lockfile gate (claude binary
  resolved, onboarding flags pre-set, bridge constructed without
  error).

**Not yet verified live (because the user already has a server
instance running on PID 96437):**

- End-to-end happy path through a real Claude turn.
- Streaming deltas rendering smoothly.
- `canUseTool` round-trip with the new `permission-response` frame.
- Session resume after drain.
- Interrupt mid-turn.

The first time someone runs `pnpm dev` against this branch they
should treat the above as the smoke checklist.

---

## 4. Feature gaps vs t3code

Ordered roughly by user-visible impact. Items marked **P0** are likely
blockers for the "same feeling as t3code" bar the user set; **P1** are
parity gaps that don't break the basic loop; **P2** are nice-to-haves.

### P0 — needed for parity

1. **AskUserQuestion rendering.**
   - Server: the SDK fires `AskUserQuestion` through `canUseTool`, so
     today it surfaces as a `pending-permission` card with `toolName ==
     "AskUserQuestion"`. Usable but ugly.
   - Need: detect `AskUserQuestion` in
     [`claude-session-bridge.ts`](../ui/apps/server/src/process-manager/claude-session-bridge.ts)
     `handleCanUseTool`, branch to emit a `pending-question` frame
     (already typed) with the parsed `question` / `options`, and
     resolve via a new `question-response` handler in the bridge.
   - Frontend:
     [`AskUserQuestionPicker.tsx`](../ui/apps/web/src/components/chat/AskUserQuestionPicker.tsx)
     already exists from the demo wiring. Add a `pendingQuestion`
     branch to `live-chat.tsx` next to the permission one and forward
     the answer as a `question-response` frame.

2. **Code-block syntax highlighting.**
   - t3code uses Shiki via `@pierre/diffs`'s `DiffsHighlighter`.
   - loom currently ships plain `<pre><code>` blocks with CSS only.
   - Lowest-cost replacement: `shiki` directly (or `marked-shiki`).
   - Estimated work: a couple hours, but adds ~200 KB to the bundle.

3. **Stop / Continue / interrupt semantics.**
   - The Stop button is wired to `Query.interrupt()` via the SDK, but
     the user can't *resume* an interrupted turn. The SDK's
     `setPermissionMode` and queue priorities aren't exposed at all.
   - Need: at minimum, surface `turnState === "interrupted"` more
     clearly in the UI and let the next user message re-prime the
     queue (current code already does the latter implicitly — confirm
     it works end-to-end).

4. **Tool results that are images / file attachments.**
   - `ToolUseCard` renders `result.text` as a single block. Read of a
     binary file, screenshot result from `mcp` tools, etc. are
     truncated to 4 KB plain text and look broken.
   - Need: detect `image` blocks in `flattenResultText` and surface as
     `<img>`.

5. **Plan mode / ProposedPlan rendering.**
   - t3code has a full `ProposedPlanCard` UX (with sourceProposedPlan
     in `ThreadTurnStartCommand`). When claude is in `plan`
     permission mode and emits `ExitPlanMode`, it sends a structured
     plan back; t3code renders it as a separate timeline row with
     accept/reject buttons.
   - loom currently drops this — the plan is rendered as a normal
     assistant message. Need a `plan-proposed` item kind in
     `messages.ts`, detection in `handleSdkMessage` (look for the
     `ExitPlanMode` tool use), and a `ProposedPlanCard` component
     ported from t3code (much trimmed).

### P1 — parity gaps

6. **Composer features.** Today the composer is text-only.
   - **Image attachments** (drag-drop, paste, file picker → multipart
     upload → `SDKUserMessage` with image blocks). Server already has
     `mountUploadImageRoute`; needs wiring into the user-turn frame.
   - **@-file mention autocomplete.** `mountFileSearchRoute` exists
     server-side. Needs a popover component on the composer.
   - **Slash-command autocomplete.** `mountSlashCommandsRoute` exists.
     The SDK accepts slash commands by sending them as a normal user
     message starting with `/`.

7. **Model picker.** loom's composer footer shows a static "claude"
   label. t3code's `ProviderModelPicker` lets the user pick model +
   options per turn (`modelSelection`). The SDK's `query` accepts a
   `model` option. Needs a UI dropdown + a `modelSelection` field on
   the `user-turn` frame and propagation to the bridge's options.

8. **MCP server status / config UI.** t3code shows MCP server
   connection status in the sidebar. loom doesn't surface this at
   all. The SDK exposes status via `SDKMessage` system subtypes.

9. **Subagent / Task rendering.** When claude invokes a subagent via
   the `Task` tool, t3code renders a nested transcript via
   `forwardSubagentText: true`. Currently loom shows only the parent
   tool_use card. Need:
   - Set `forwardSubagentText: true` on `Options`.
   - Group items by `parent_tool_use_id` in `MessagesTimeline` and
     render them inside the parent `ToolUseCard`.

10. **Diff panel for file changes.** t3code's `DiffPanel` shows the
    cumulative diff for a turn (`thread.turn.diff.complete`). loom has
    a `mountDiffRoute` server-side and a demo `chat-mock/permission`
    route, but the live chat doesn't render diffs.

11. **Pending-input "while running" queueing.** t3code supports
    typing a follow-up while the turn is still streaming; it queues
    as `priority: "next"`. Today loom's composer simply ignores
    submits while disabled. Needs a non-disabled "queue" mode.

12. **Persistent error banner.** When `turnState === "error"` we show
    a small banner under the timeline, but it disappears on the next
    snapshot. t3code keeps `ThreadErrorBanner` sticky with a dismiss
    button.

### P2 — polish

13. **Markdown polish.** No file-path autolinking (t3code's
    `MarkdownFileLink`), no clipboard-copy button on code blocks
    (`MessageCopyButton`), no inline checkboxes for GFM task lists
    (works via CSS but no interactivity).

14. **Thinking-block timing.** t3code's `LiveMessageMeta` shows
    elapsed time per assistant turn. loom shows nothing.

15. **Virtualization.** None. With > a few hundred messages the
    timeline will start to feel sluggish. t3code uses `LegendList`.
    Defer until it actually hurts.

16. **Compaction boundaries.** SDK emits
    `SDKCompactBoundaryMessage`; loom ignores it. t3code renders a
    "Conversation summarized" divider.

17. **Status / rate-limit / API-retry messages.** Multiple SDK
    message subtypes (`status`, `api_retry`, `rate_limit_event`) are
    ignored. Useful debugging signal — surface as system-notice items
    or in a footer.

18. **TasksPanel duplication.** Today tasks are derived twice — once
    from the SDK tool_use blocks (correctly) but the legacy
    `tasks-update` envelope is still in the typed mirror because the
    server doesn't actually emit it anymore. Either wire the bridge
    to also emit `tasks-update` on `maybeUpdateTasks` or remove the
    frame from `chat-types.ts`. Currently the panel never updates.

### Cleanup punch list

- `apps/web/src/routes/chat.tsx` is the old hardcoded demo
  (worktree/permission/askuserquestion/multi-tab variants). It still
  works as a static mockup but is no longer the canonical surface.
  Delete it once §P0 items are done.
- `ui/README.md` still says "chat output is rendered with xterm.js…"
  — update once the new flow is verified live.
- The "Terminal" toggle button in `ChatHeader.tsx` is decorative; it
  points at nothing. Either wire it to a real shell pane or remove.
- `chat-protocol/envelope.ts` still defines a legacy `EnvelopeKind`
  union with strings like `pty-bytes-up` that no one uses. Safe to
  delete after a grep for stragglers.
- `hook-receiver/` is still mounted and registers user-scope hooks.
  Most of its job (PermissionRequest, AskUserQuestion) is now handled
  by the SDK directly. Investigate whether anything still needs it
  (SessionStart for telemetry? Stop for the sidebar's pending-gate
  cleanup?) and trim or remove.

---

## 5. Risks and unknowns

- **SDK upgrade churn.** Pinned to `@anthropic-ai/claude-agent-sdk
  ^0.2.138`. The SDK is pre-1.0; message shapes can shift. The bridge
  defensively handles unknown `SDKMessage` types, but new fields on
  `BetaMessage` content blocks (e.g. a new block type beyond
  text/thinking/tool_use) will silently render as empty.
- **Resume semantics.** The "use `resume` after drain, use `sessionId`
  on first spawn" pattern is preserved from the old bridge but
  **untested end-to-end** with the SDK. Worth a manual confirmation
  that the resumed session replays prior messages into the timeline
  (the bridge's snapshot only includes items it saw, so resumed
  messages must arrive as SDK events to land in `items`).
- **`marked` is sync and runs on every text delta.** Fine for normal
  message sizes; pathological if claude streams a 50 KB single
  message. If you hit jank, debounce the render or move to
  `react-markdown`.
- **`dangerouslySetInnerHTML`.** Trust boundary: marked renders
  trusted markdown to safe HTML without raw-HTML passthrough by
  default. If anyone later sets `marked.setOptions({ html: true })`,
  it becomes an XSS vector.
- **No tests for the new bridge.** The deleted `chat-pty-bridge.test.ts`
  exercised attach / detach / drain / replay. Equivalent coverage for
  `ClaudeSessionBridge` doesn't exist. The SDK is hard to mock — the
  cleanest path is probably a fake `query()` that yields a scripted
  `SDKMessage` sequence.

---

## 6. Suggested follow-up order

1. Run `pnpm dev` and walk the smoke checklist in §3.
2. Fix #18 (`tasks-update` plumbing) so the side-panel works again —
   ~10 lines.
3. Build the AskUserQuestion branch (P0 #1) — that's the visible gap
   most likely to bite next.
4. Re-evaluate the rest of §4 against actual usage. Several P1 items
   may turn out to be unnecessary for loom's narrower scope (e.g.
   you may not want model-picker UI inside chat if loom always
   defaults to one model per project).
