---
project: jsonl-viewer-pivot
task: T-001
created: 2026-05-23
---

# JSONL event catalog

## Method

Phase 0 was originally planned as a HITL task in which a developer
would drive a fresh `claude` session through every scenario and capture
the resulting JSONL. We bypassed that by mining the JSONL transcripts
already on disk in `~/.claude/projects/`, which gives broader scenario
coverage (multiple projects, multiple permission modes, multiple
`claude` versions) at the cost of not being able to fabricate
synthetic scenarios on demand.

**Sample population**

- Transcript root: `~/.claude/projects/`
- Project directories sampled: 8 (one per distinct encoded-cwd on this
  machine, including the loom workspace, the `aper` workspace, the
  `bmpi-ai-tools` workspace, and several others).
- Transcript files scanned: 1,005 `.jsonl` files.
- Total events scanned: ~165,000 lines.
- `claude` version on this host (live): **2.1.150**.
- `claude` versions appearing in scanned transcripts: **2.1.117 →
  2.1.150** (every minor version in between except a few gaps). The
  type/field set documented below is stable across that range.
- The currently-running `/weave` session's own transcript was
  included in the sample (file
  `<HOME>/.claude/projects/-Volumes-My-Shared-Files-repo-loom/ec847f04-4d6c-4015-885b-1df76bb43097.jsonl`,
  317 lines at sampling time), which is the source of the
  `01-text-and-tools.jsonl`, `10-ask-user-question.jsonl`, and
  `11-edit-tool.jsonl` fixtures.

**Top-level `type` field distribution across the full sample**

| count | type |
| ---: | --- |
| 79,078 | `assistant` |
| 55,789 | `user` |
| 10,096 | `attachment` |
| 5,708 | `last-prompt` |
| 4,984 | `permission-mode` |
| 3,357 | `file-history-snapshot` |
| 2,631 | `ai-title` |
| 2,321 | `system` |
| 1,246 | `queue-operation` |
| 27 | `custom-title` |
| 10 | `agent-name` |
| 4 | `agent-setting` |

These are the only top-level `type` values observed. The discriminated
union the translator emits (`schema.ts § ClaudeEvent`) must cover the
top three (`assistant`, `user`, `attachment`) richly and the remainder
either as control / metadata events or as `unknown` for graceful
forward-compat.

## Scenario coverage table

| # | Scenario | In JSONL? | type field | Key payload shape | Fixture |
| - | -------- | --------- | ---------- | ----------------- | ------- |
| 1 | Plain text user turn | yes | `user` | `message.content` is `string` OR `[{type:"text", text}]`; metadata: `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `promptId`, `userType`, `entrypoint` | `01-text-and-tools.jsonl` |
| 1 | Plain text assistant turn | yes | `assistant` | `message.content[]` items of `type:"text"\|"thinking"\|"tool_use"`; `message.role:"assistant"`; `message.model`; `requestId`; `attributionSkill` | `01-text-and-tools.jsonl` |
| 2 | tool_use (Read / Bash / Edit / Glob / Grep) | yes | `assistant` | content item `{type:"tool_use", id:"toolu_…", name, input, caller:{type:"direct"}}` — `input` shape per tool: Read `{file_path, limit?, offset?}`, Bash `{command, description}`, Edit `{file_path, old_string, new_string, replace_all}` | `01-text-and-tools.jsonl`, `11-edit-tool.jsonl` |
| 3 | tool_result success | yes | `user` | content item `{type:"tool_result", tool_use_id, content, is_error?}`. `content` is `string` OR `[{type:"text", text}]`. Top-level event also carries `toolUseResult:{stdout, stderr, interrupted, isImage, noOutputExpected}` (Bash) or a similar tool-specific summary; `sourceToolAssistantUUID` links back to the `assistant` event that issued the `tool_use` | `01-text-and-tools.jsonl` |
| 4 | tool_result error | yes | `user` | same shape as success, with `content:"<tool_use_error>…</tool_use_error>"` (a tagged string) and `is_error:true`. Sub-flavours observed: `<tool_use_error>Blocked: …</tool_use_error>` (hook/policy blocker), `<tool_use_error>Cancelled: …</tool_use_error>` (parallel tool cancel), `<tool_use_error>String to replace not found …</tool_use_error>` (Edit miss), `<tool_use_error>Error: No such tool available …</tool_use_error>` (subagent tool-allowlist miss) | `02-tool-result-error.jsonl` |
| 5 | TodoWrite multi-step | yes | `assistant` | tool_use with `name:"TodoWrite"` and `input:{todos:[{content, activeForm, status:"pending"\|"in_progress"\|"completed"}]}`. Multiple sequential TodoWrite events in a single turn carry the evolving task list; `tasks-update` derivation is keyed off the latest one. | `03-todowrite.jsonl` |
| 6a | Permission prompt — **prompt itself** | **NO** | (none) | The interactive "Allow / Reject" prompt rendered in the terminal is **not** an event in JSONL. JSONL only records the outcome (6b/6c). See **Gate summary** below. | (not observed) |
| 6b | Permission prompt — user rejected | yes (outcome only) | `user` | `tool_result` with `is_error:true`, `content:"The user doesn't want to proceed with this tool use. The tool use was rejected …"` and top-level `toolUseResult:"User rejected tool use"`. The matching `tool_use` carries the original input (so the bridge knows what the user said no to, after the fact). | `04-permission-rejected.jsonl` |
| 6c | Permission prompt — auto-mode classifier denied | yes | `user` | `tool_result` with `is_error:true`, `content:"Permission for this action was denied by the Claude Code auto mode classifier. Reason: …"`. Only fires when `permissionMode == "auto"`. | `05-permission-auto-denied.jsonl` |
| 7 | `/clear` | yes | `user` (isMeta + system) | A user event with `isMeta:true` + `message.content:"<local-command-caveat>…"` immediately preceding a `user` event whose `message.content:"<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>"`. Followed by a `system` event with `subtype:"local_command"` and `content:"<local-command-stdout>…</local-command-stdout>"`. JSONL records the slash-command invocation as terminal-side metadata; there is no semantic "session cleared" event — the chat continues in the same file and the absence of an `assistant` reply is the cue. | `06-slash-clear.jsonl` |
| 8 | Mid-turn interrupt (Esc) | yes | `user` | `user` event with `message.content:[{type:"text", text:"[Request interrupted by user]"}]`. Note: this is the literal text Claude sees as the next user turn, NOT a control event. There is no separate "user pressed Esc" record; the bridge infers the interrupt from this sentinel message. | `07-mid-turn-interrupt.jsonl` |
| 9 | `/model` switch | yes | `user` (3 events) | Same shape as `/clear`: `local-command-caveat` (isMeta), then `<command-name>/model</command-name>` user event, then a `system`/`subtype:local_command` event whose `content` carries `<local-command-stdout>Set model to <ANSI bold>Opus 4.7 …</ANSI></local-command-stdout>`. ANSI escape codes survive into the JSONL. | `08-slash-model.jsonl` |
| 10 | Session resume (`claude --resume`) | yes | `user` | A resumed transcript starts with a `user` event whose `message.content` is a long string beginning `"This session is being continued from a previous conversation that ran out of context. The summary below covers …"` followed by an LLM-authored summary. The new `sessionId` is in the event metadata; the previous chat's UUIDs are not directly linked — discovery requires the operator to know which session was resumed. The transcript may also include earlier `attachment` `type:"hook_success"` events for `SessionStart:startup`. | `09-session-resume.jsonl` |
| 11 | Plan mode (`acceptPlanProposal` / `rejectPlanProposal`) | **not observed** | (n/a) | No `ExitPlanMode` / `exit_plan_mode` tool_use was found in any sampled transcript. Plan mode is either not in use on this host or the artefact name differs from what we searched. The transcripts do contain `permission-mode` records but the values seen are `default`, `auto`, `acceptEdits`, `bypassPermissions` — no `plan` value. **Recommendation:** treat plan-mode events as a separate sub-investigation when a plan-mode-using user is available; the translator's `unknown` variant catches them safely until then. |
| 12 | `respondToQuestion` (AskUserQuestion) | yes | `assistant` tool_use + `user` tool_result | tool_use with `name:"AskUserQuestion"` and `input:{questions:[{question, header, multiSelect:bool, options:[{label, description}]}]}`; followed by a `user` `tool_result` whose `content` is a string like `"Your questions have been answered: \"<question>\"=\"<chosen label>\". You can now continue with these answers in mind."`. The chosen-option label is the integration key (not an option index). | `10-ask-user-question.jsonl` |

## Per-scenario detail

### 1. Plain text user turn → assistant text turn

**User side** (line 1 of `01-text-and-tools.jsonl`, originally line 1
of the current weave session):

```jsonc
{
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "1f7f3a99-1a23-44e8-bd33-fbcb6c69e58b",
  "type": "user",
  "message": {
    "role": "user",
    "content": "/weave <REPO_ROOT>/repo/scratch/seeds/loom-ui-pivot-jsonl-viewer.md"
  },
  "uuid": "1acc4663-1b4b-42f3-8637-0dafc4040b23",
  "timestamp": "…",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "<REPO_ROOT>/repo/loom",
  "sessionId": "ec847f04-…",
  "version": "2.1.150",
  "gitBranch": "dev"
}
```

Note: when the user submits via the CLI prompt, `message.content` is a
plain `string`. When the user replies via a tool-result completion or
the assistant resubmits internally, `message.content` is an array of
content blocks. Both shapes occur in the same transcript.

**Assistant side**: a flurry of `assistant` events, each carrying one
or more content blocks (`thinking`, `text`, `tool_use`). A single
"turn" from the user's perspective produces multiple `assistant`
records — each `tool_use` is its own event, each `text` block can be
its own event, all sharing the same `requestId`.

Citations: `01-text-and-tools.jsonl` lines 1–30.

### 2. tool_use (Read / Bash / Edit / Glob / Grep)

All tool_use events live inside an `assistant` event's
`message.content[]` as `{type:"tool_use", id, name, input, caller}`.
`caller.type` is `"direct"` for top-level tool calls. The `id` is a
stable `toolu_…` identifier used as the dedupe key for the matching
`tool_result`.

Tool-specific `input` shapes observed across the sample (full list of
tool names seen: Agent, AskUserQuestion, Bash, Edit, Glob, Grep,
Monitor, Read, ScheduleWakeup, Skill, TaskCreate, TaskList, TaskOutput,
TaskStop, TaskUpdate, TodoWrite, ToolSearch, WebFetch, WebSearch, Write,
mcp__puppeteer__*):

| name | input keys |
| ---- | ---------- |
| Read | `file_path`, `limit?`, `offset?` |
| Bash | `command`, `description` |
| Edit | `file_path`, `old_string`, `new_string`, `replace_all` |
| Glob | `pattern`, `path?` |
| Grep | `pattern`, `path?`, `output_mode?`, `glob?`, …  (not in fixture but observed in the wild) |
| TodoWrite | `todos` |
| AskUserQuestion | `questions` |
| Agent | `description`, `prompt`, `subagent_type` |

Citations: `01-text-and-tools.jsonl` lines containing
`"type":"tool_use"`; `11-edit-tool.jsonl` for the Edit shape.

### 3. tool_result success

`user` event whose `message.content[]` contains a single
`{type:"tool_result", tool_use_id, content, is_error?}` block.
`content` is either a `string` (most tools) or an array of content
blocks (some tools — observed shape `[{type:"text", text}]` and
`[{type:"tool_name", …}]`).

Top-level the event carries a `toolUseResult` field that mirrors the
content but adds structured metadata (`stdout`, `stderr`,
`interrupted`, `isImage`, `noOutputExpected` for Bash; tool-specific
shapes for others) and a `sourceToolAssistantUUID` linking back to the
`assistant` event that issued the `tool_use`.

`is_error` is **omitted or `false`** for successes (no fixture line
shows `is_error:false` explicitly — only `is_error:true` is
serialised).

Citations: `01-text-and-tools.jsonl`, every other line in the
tool-use/tool-result pairs.

### 4. tool_result error

Same envelope as success, but `is_error:true` and `content` is a
tagged string `"<tool_use_error>…</tool_use_error>"`. Sub-flavours
observed:

- `Blocked: …` — hook policy blocker (e.g. the loom dev box's
  `sleep 30 followed by …` block rule).
- `Cancelled: parallel tool call … errored` — parallel tool-call
  cancellation.
- `String to replace not found in file.` — Edit miss.
- `Error: No such tool available: AskUserQuestion. AskUserQuestion is
  not available inside subagents.` — subagent tool-allowlist miss.
- `File has been modified since read, either by the user or by a
  linter. Read it again before attempting to write it.` — Edit
  staleness guard.

The bridge MAY surface the prefix word after `<tool_use_error>` as a
sub-category for richer UI hints, but the translator should treat all
of them uniformly as `tool_result` with `ok:false`.

Citations: `02-tool-result-error.jsonl`.

### 5. TodoWrite multi-step

`assistant` event with content block
`{type:"tool_use", name:"TodoWrite", input:{todos:[…]}}`. Each todo is
`{content, activeForm, status}`. `status` is one of `"pending"`,
`"in_progress"`, `"completed"`.

A working session produces a sequence of TodoWrite events as the
agent flips a task from `pending` → `in_progress` → `completed`. The
materializer should treat **the latest TodoWrite's `todos` array as
the authoritative task list** (replace, not merge) and emit a
`tasks-update` frame on each one. This matches the SDK bridge's
existing derivation.

The matching `tool_result` for a TodoWrite is a short string
confirming the update (e.g. `"Todos have been modified successfully …"`)
and carries no task-state payload — the truth lives in the `tool_use.input`.

Citations: `03-todowrite.jsonl`.

### 6. Permission prompts — load-bearing finding

This is the Q04 gate. Three modes were observed:

**6a. The prompt itself.** When Claude attempts a tool use that
requires permission in `default` mode, the terminal renders an
interactive "Allow this Bash command? (y/n)" prompt. **No JSONL event
is written at that moment.** The transcript stops at the `assistant`
event carrying the `tool_use` and resumes only after the user's
keystroke decision.

This is the critical finding: the **pending state** is not visible to
a JSONL tail. A loom UI tailing JSONL alone cannot show a "permission
pending" card — by the time anything appears in JSONL, the user has
already decided.

**6b. User rejected.** The next JSONL event after the silently-pending
period is a `user` event whose `tool_result` content reads:

```
The user doesn't want to proceed with this tool use. The tool use was
rejected (eg. if it was a file edit, the new_string was NOT written to
the file). STOP what you are doing and wait for the user to tell you
how to proceed.
```

with `is_error:true` and the top-level event field
`toolUseResult:"User rejected tool use"`.

A bridge can detect a rejection retroactively by pattern-matching this
sentinel, but cannot show the prompt.

**6c. Auto-mode classifier denied.** When `permissionMode == "auto"`,
the classifier inside `claude` decides without prompting the user. A
denial surfaces as a `tool_result` with `content` starting
`"Permission for this action was denied by the Claude Code auto mode
classifier. Reason: …"`. This is fully visible in JSONL.

**6d. `bypassPermissions` mode.** No prompt and no denial event;
tools just run. The bulk of the sampled sessions ran in this mode.

Citations: `04-permission-rejected.jsonl`, `05-permission-auto-denied.jsonl`.

### 7. `/clear`

Three JSONL events fire when the user types `/clear`:

1. A `user` event with `isMeta:true` and
   `message.content:"<local-command-caveat>Caveat: The messages
   below were generated by the user while running local commands. DO
   NOT respond to these messages or otherwise consider them in your
   response unless the user explicitly asks you to.</local-command-caveat>"`.
2. A `user` event whose `message.content` is the literal slash-command
   marker: `"<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>"`.
3. A `system` event with `subtype:"local_command"` and
   `content:"<local-command-stdout>…</local-command-stdout>"`.

Importantly, **the chat itself does not "reset" in JSONL**. The
session keeps writing to the same `<sessionId>.jsonl` file. `/clear`
is a UI hint that subsequent turns should be presented to the user
without the prior context, but the JSONL transcript carries everything
in one file. The bridge's materializer needs to honour the
`/clear` hint by tracking a "clear point" offset and only
re-emitting items past that offset on snapshot.

Citations: `06-slash-clear.jsonl`.

### 8. Mid-turn interrupt (Esc)

When the user presses Esc mid-turn, the next `user` event has
`message.content:[{type:"text", text:"[Request interrupted by user]"}]`.
There is no separate control event. The bridge detects an interrupt by
pattern-matching this sentinel against `message.content[0].text` on a
`user` event.

The immediately-preceding `assistant` event's last `tool_use` is the
one that was interrupted; its matching `tool_result` either never
appears or appears as a `Cancelled` error.

Citations: `07-mid-turn-interrupt.jsonl`.

### 9. `/model` switch

Same three-event pattern as `/clear` but with `command-name>/model`.
The `system`/`local_command` stdout carries the new model name with
embedded ANSI escape codes:

```
<local-command-stdout>Set model to \x1b[1mOpus 4.7 (1M context) (default)\x1b[22m</local-command-stdout>
```

The bridge should strip ANSI when surfacing this to the UI.

Note: changing the model does NOT emit a `permission-mode` event — it
is purely a `system`/`local_command` artifact.

Citations: `08-slash-model.jsonl`.

### 10. Session resume

A resumed transcript begins with a `user` event whose `message.content`
is a multi-paragraph string starting:

```
This session is being continued from a previous conversation that ran
out of context. The summary below covers the earlier portion of the
conversation.

Summary:
1. Primary Request and Intent:
   …
```

The resumed `sessionId` is in the event metadata; there is no field
linking back to the prior session's UUID. The bridge sees the resume
as a normal user turn whose content happens to start with that
sentinel; the materializer should treat it as an initial `snapshot`
boundary and may want to emit a "resumed" UI hint.

There may also be earlier `attachment` events with
`hookEvent:"SessionStart"` (when the hook receiver was wired) — those
are loom's own infrastructure and not native `claude` events.

Citations: `09-session-resume.jsonl`.

### 11. Plan mode

**Not observed in any sampled transcript.** No tool_use named
`ExitPlanMode` or `exit_plan_mode` was found across the 1,005
transcripts and 165,379 events scanned. No `permission-mode` value
of `plan` was observed (only `default`, `auto`, `acceptEdits`,
`bypassPermissions`).

This is a real gap in the catalog and should be filled when a
plan-mode-using user is available. Until then, the bridge's
`acceptPlanProposal` / `rejectPlanProposal` methods route through
`tmux.sendInput` (per US-009 AC3) and the translator emits an
`unknown` event for any unrecognised plan-related JSONL record,
making the gap detectable but non-fatal.

### 12. `respondToQuestion` (AskUserQuestion)

`AskUserQuestion` is a regular `tool_use` whose input shape is
`{questions:[{question:string, header:string, multiSelect:bool,
options:[{label:string, description:string}]}]}`. The matching
`tool_result` is a `user` event whose `message.content[0].content`
(when the content is an array) or `content` (string form) reads:

```
Your questions have been answered: "<the question text verbatim>"="<the chosen option label verbatim>". You can now continue with these answers in mind.
```

Multiple questions in a single AskUserQuestion bundle produce a
comma-separated list of `"q"="a"` pairs in the same string.

The bridge's `respondToQuestion(chatId, id, {answers, otherText})`
needs to translate the UI's selected-option index back to the
`label` string and `send-keys -l --` that literal into the tmux
session, where `claude`'s interactive AskUserQuestion picker is
waiting.

Citations: `10-ask-user-question.jsonl`.

## Gate summary

- **US-004 AC4 (permission prompts in JSONL):** **NOT IN JSONL.**
  The interactive permission prompt rendered by `claude` in `default`
  mode is not emitted as a JSONL event. Only the post-decision
  outcome (rejection text or successful tool_result) is visible.
  Decision: **T-014 lands.** Phase E (`PreToolUse` hook installation
  + `loom:permission-prompt` side-channel) is required to surface
  the pending-permission UI in loom's structured chat.

- **Scope of T-014.** The hook installer registers `PreToolUse` in
  `~/.claude/settings.json`'s `DEFAULT_EVENTS`. The receiver
  normalises the hook payload into a `loom:permission-prompt`
  envelope. The translator emits the existing `pending-permission`
  `ServerFrame` from that envelope. The UI sees no change.

- **JSONL-side cleanup helper.** Even with the hook in place, the
  translator should also detect the post-decision JSONL sentinels
  ("`The user doesn't want to proceed …`" and "`Permission for this
  action was denied by the Claude Code auto mode classifier …`") and
  emit a corresponding `permission-resolved` frame, so that the
  pending card clears even if the hook receiver was offline when the
  decision was made. This is a small additional translator rule, not
  a separate task.

- **Other gates surfaced:**
  - **Plan mode events not observed.** The bridge surface accepts
    `acceptPlanProposal` / `rejectPlanProposal` per US-009 AC3 and
    routes them through `tmux.sendInput`, but the translator's
    inbound plan-mode parsing is best-effort until a plan-mode
    transcript is captured. Treat as a follow-up `unknown` event
    until then.
  - **`/clear` semantics.** The chat does not reset on disk; the
    materializer needs to honour a "clear point" offset and exclude
    pre-clear items from snapshot frames.
  - **Mid-turn interrupt is text-shaped.** The interrupt sentinel is
    a `user` event with literal text `[Request interrupted by user]`,
    not a control event. The translator must pattern-match it.

## Schema-version evidence

- `claude` versions observed in the sampled transcripts:
  `2.1.117 → 2.1.150` (every minor in between except a few skipped
  patches).
- Every transcript carries `version` at the event level; this is
  the version string Loom's `schemaVersion` stamp should mirror for
  golden-file drift detection.
- The type and field set observed is **stable across the entire
  version range**. No type was added or removed across the sample.
  The four `permission-mode` values (`default`, `auto`,
  `acceptEdits`, `bypassPermissions`) are also stable.
- `attachment.type` values observed: `task_reminder`,
  `edited_text_file`, `skill_listing`, `deferred_tools_delta`,
  `command_permissions`, `hook_success`, `hook_non_blocking_error`.
  The latter two are loom-instrumentation artefacts (the hook
  receiver POSTing back), not native `claude` events; the bridge's
  translator should silently absorb them as `unknown` for now.

Conclusion: a single `v1` parser covers the entire 2.1.x range
observed. The schema-version selector (`parserFor(version)`) exists
for future drift but is not exercised by today's transcripts.

## Fixtures shipped

All fixtures live under
`ui/apps/server/test/fixtures/jsonl/`. Total size: 242 KB across
11 files. All PII scrubbed: `/Users/claudevm` → `<HOME>`,
`/Volumes/My Shared Files` → `<REPO_ROOT>`, email addresses → `<EMAIL>`.

| File | Lines | Bytes | Scenarios | Golden-test assertions |
| ---- | ---: | ---: | --------- | ---------------------- |
| `01-text-and-tools.jsonl` | 30 | 123K | 1, 2 (Read, Bash, AskUserQuestion), 3, parts of permission-mode metadata | translator emits `text` events for both roles, `tool_use` events with correct `name`/`input`, `tool_result` success events, dedupe key sourced from `uuid` |
| `02-tool-result-error.jsonl` | 13 | 17K | 4 (`<tool_use_error>Blocked: …`) | translator emits `tool_result` with `ok:false` for tagged-error content |
| `03-todowrite.jsonl` | 7 | 23K | 5 | translator emits `todo_write` event; materializer derives `tasks-update` frame with the full latest todo list |
| `04-permission-rejected.jsonl` | 5 | 7K | 6b | translator emits a `permission_resolved` (rejection) marker for the sentinel string |
| `05-permission-auto-denied.jsonl` | 6 | 10K | 6c | translator recognises the auto-mode classifier denial and emits `permission_resolved` (auto-deny) |
| `06-slash-clear.jsonl` | 5 | 2.5K | 7 | translator emits a `slash_command_set` or `session_meta` event for the `/clear` invocation; materializer flags a clear-point offset |
| `07-mid-turn-interrupt.jsonl` | 6 | 9K | 8 | translator detects the `[Request interrupted by user]` sentinel and emits a `session_meta` (lifecycle: `interrupted`) event |
| `08-slash-model.jsonl` | 5 | 5K | 9 | translator strips ANSI from the model-change stdout and emits a `session_meta` (lifecycle: `model_changed`) event with the new model string |
| `09-session-resume.jsonl` | 4 | 31K | 10 | translator detects the resume sentinel and emits a `session_meta` (lifecycle: `resumed`) event; materializer treats the resume summary as a snapshot anchor |
| `10-ask-user-question.jsonl` | 6 | 9K | 12 | translator emits a `tool_use` (AskUserQuestion) event; materializer pairs it with the matching `tool_result` and derives a `pending-question` → `permission-resolved` sequence |
| `11-edit-tool.jsonl` | 4 | 7K | 2 (Edit) | translator emits `tool_use` with `name:"Edit"` and the full `{file_path, old_string, new_string, replace_all}` input |

**Not shipped:** a plan-mode fixture, because plan-mode events were
not observed in any sampled transcript (scenario 11). T-014's
acceptance does not depend on this; the bridge surface accepts plan
methods and routes them through `tmux.sendInput` regardless. When a
plan-mode transcript becomes available, this catalog and the
fixtures should be amended.
