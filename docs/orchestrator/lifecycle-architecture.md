# Loom Lifecycle — Architecture

How Loom maps onto Claude Code's agent primitives: who dispatches what, where work runs, and which mechanics constrain the shape. This is the load-bearing reference for anyone changing the workflow tree.

The conceptual case for the five phases lives in `lifecycle-concepts-toc.md`. This file is the mechanical companion: agents, subagents, methods, dispatch tree.

---

## 1. Claude Code mechanics the design rests on

These are platform facts, verified against the published documentation and against on-disk session transcripts. Treat them as fixed; do not reopen them without re-verifying.

### 1.1 Subagents cannot spawn subagents

A subagent dispatched via the `Agent` tool (formerly `Task`) cannot itself call the `Agent` tool. The documentation states this in three independent places: *"subagents cannot spawn other subagents"* — depth is structurally capped at one. The Anthropic Claude Code subagents page is the authoritative source.

Implication: only the entity that runs in the **main session** can dispatch subagents. In Loom, that entity is `/weave` (a skill, not a subagent — it executes inline in the user's main session). Every Loom subagent is depth-1 from `/weave`. No phase agent can fan out to further subagents.

### 1.2 The `Agent` tool returns only the worker's final assistant message

When a subagent completes, the `tool_result` returned to the caller contains exactly one text block: the subagent's final assistant turn. Intermediate tool calls, internal reasoning, failed attempts, and the entire transcript stay in the subagent's own session. This is verified directly from session transcripts on disk.

Implication: caller context never absorbs worker tool history. The "isolation" property that makes subagents valuable is structural and free; it does not require any additional discipline at the dispatch layer.

### 1.3 Each `Agent` call is a fresh session

Sessions cannot be resumed. A subagent that returns is gone; the next `Agent` call with the same definition creates a brand-new session with empty context. There is no API to "send another turn" to a prior subagent.

Implication: two kinds of caching exist, and they behave differently.

- **Within-session amortization.** A single subagent that does many turns reads its own accumulated prefix at `cache_read` rates (~$0.10 / 1M tokens) on every internal turn. This is the dominant cost-saving mechanism when one session does many units of work.
- **Cross-session prefix sharing.** Two separate fresh sessions dispatched with byte-identical head bytes within ~5 minutes (Anthropic ephemeral prompt cache TTL) share the head's `cache_creation` cost — the second session reads it at `cache_read` rates. Anything past the first differing byte is recomputed per session.

The byte-stability discipline in `SKILL.md` § Cached-prefix boundary is what makes cross-session sharing possible. Within-session amortization is a property of session length, not of dispatch shape.

### 1.4 Parallel dispatch is per-turn fan-out

Multiple `Agent` blocks in a single assistant turn run concurrently; the caller waits for all of them before its next turn. This is the only built-in parallelism. There is no way to parallelize within a single subagent's session.

---

## 2. Lifecycle and dispatch tree

Loom is five phases — **Spec → Design → Plan → Build → Review** — each gated by a human-in-the-loop `AskUserQuestion` between phases. The orchestrator stays running for the entire lifecycle.

```
/weave  (skill, runs in user's main session — dispatches all subagents)
   │
   ├─► Agent: Spec phase                                [depth-1 subagent]
   │     reads:  seed.md
   │     writes: spec.md, decisions.md
   │     inlined: applies methods/grilling.md procedure (arrives in dispatch head)
   │
   ├─► HITL gate (AskUserQuestion in /weave)
   │
   ├─► Agent: Design phase                              [depth-1 subagent]
   │     reads:  spec.md, decisions.md
   │     writes: design.md, mockup/ (when applicable)
   │
   ├─► HITL gate
   │
   ├─► Agent: Plan phase                                [depth-1 subagent]
   │     reads:  spec.md, design.md
   │     writes: plan.md, board.md, task.md, tests.md, tasks/T-*.md
   │
   ├─► HITL gate
   │
   ├─► Agent: Build phase                               [depth-1 subagent, long session]
   │     reads:  spec.md, design.md, plan.md, board.md, tests.md, tasks/T-*.md
   │     inlined: principles.md, methods/task.md, methods/mutation.md, methods/smoke.md
   │     internal work loop:
   │       for each task in dependency order:
   │         apply the inlined methods/task.md procedure (Lock → Red → Implement → Green → Done)
   │         apply the inlined methods/mutation.md procedure when tests.md opts in
   │       apply the inlined methods/smoke.md procedure (once, when project is runnable)
   │     writes: repository files, tasks/T-*.done.md, tasks/T-*.test-log.txt,
   │             smoke-report.md, test-report.md, board.md transitions
   │
   ├─► HITL gate
   │
   └─► Agent: Review phase                              [depth-1 subagent]
         reads:  spec.md, design.md, plan.md, board.md, repository
         inlined: principles.md (arrives in dispatch head)
         writes: review.md, review-verdict.json
```

Phase agents may optionally be followed by their quality-check agent when the user opts in at the gate. Quality-check agents are dispatched the same way (depth-1 from `/weave`) and produce `quality-review.md` scoped to the just-completed phase.

---

## 3. The Build phase: one session, all tasks

Build is the only phase with a long internal work loop. Its shape is the empirically cheapest legal shape under the mechanics in section 1.

### 3.1 Shape

One `/weave` dispatch per Build phase entry. The Build phase agent reads the workspace, walks the board in dependency order, and implements every ready task itself within its own session. Smoke and mutation are inline procedures within the same session — they are not separate dispatches. The Build agent returns once, after all tasks have reached a terminal state (`green` to `Review` to `Done`, `failed`, or `hitl-block`).

The procedures the Build agent applies live in `phases/build/methods/`:

| Procedure file | When applied | Scope |
|---|---|---|
| `methods/task.md` | Once per ready task | Lock → Red → Implement → Green → Done |
| `methods/mutation.md` | Per task after `green`, only when `tests.md` opts in | Test-strength check on the just-implemented task |
| `methods/smoke.md` | Once before returning, only when project is runnable | Whole-project runnable verification |

These are procedure files declared in the Build body's `## Reads`; the orchestrator inlines their content into the dispatch prompt (see `SKILL.md § Dispatch concatenation`), so the Build agent applies them from the inlined head, not from a disk read. They are not dispatched as subagents (which is structurally impossible — see 1.1).

### 3.2 Why one session for all tasks

Two reasons, both grounded in section 1's mechanics:

**Within-session amortization (1.3).** A Build session that walks N tasks pays `cache_creation` once on its head bytes, then reads its own growing prefix at `cache_read` rates on every subsequent internal turn. Splitting the same N tasks across N fresh subagents would pay `cache_creation` N times on the head, eliminating most of that amortization. Cross-session prefix sharing (1.3) recovers some of it for the head bytes alone but not for the agent's accumulated working context.

**Parallel fan-out has no legal target (1.1, 1.4).** A Build phase agent that wanted to parallelize independent tasks cannot dispatch them as further subagents. Parallelism would have to be hoisted to `/weave`, which means many short Build sessions instead of one long one — the opposite of within-session amortization. The 5-minute prefix-cache TTL (1.3) further penalizes long-spaced sequential dispatches when the head bytes go cold between waves.

The cost trade is empirical, not theoretical: one long session ran the same Build phase at substantially lower Anthropic spend than the equivalent split-dispatch shape, with the cache_read line carrying ~95 % of the input-token volume.

### 3.3 Quality posture

The Build agent's own context grows monotonically across tasks. This is by design — the prior tasks' decisions stay visible, which keeps later tasks consistent with earlier ones. The principles file and the test-strategy file constrain drift; the kanban board, written to disk each transition, is the canonical state-of-truth on completion.

The Review phase is dispatched as a separate subagent that does not inherit any Build context. The fresh-context property that motivates a dedicated Review phase is preserved at the phase boundary, not within Build.

### 3.4 Rerun behavior

A `/weave`-initiated rerun (from the rerun-or-continue gate) re-dispatches a fresh Build agent against the current board. `In Progress`, `Review`, and `Done` cards stay where they are; the new session picks up the next eligible `Backlog` cards. Each rerun is a separate session — no continuity of context across reruns, only continuity of artifacts.

---

## 4. Dispatch contract

`SKILL.md` § Dispatch concatenation defines the wire shape: every dispatch is a stable head (body file + `---` + signature file + the `## Inlined methods` band — every file in the body's `## Reads`, appended verbatim; band omitted when `## Reads` is empty) followed by a dynamic tail (one `<system-reminder>` block with substituted identifiers). The closing `</system-reminder>` is the cached-prefix boundary. The subagent fetches no method or skill file from disk; everything it needs arrives inlined in the head.

Every phase agent has the same two-file pair:

| Phase | Body | Signature |
|---|---|---|
| Spec | `phases/spec/phase.md` | `phases/spec/phase.signature.md` |
| Design | `phases/design/phase.md` | `phases/design/phase.signature.md` |
| Plan | `phases/plan/phase.md` | `phases/plan/phase.signature.md` |
| Build | `phases/build/phase.md` | `phases/build/phase.signature.md` |
| Review | `phases/review/phase.md` | `phases/review/phase.signature.md` |

Each phase except Review additionally has a quality-check pair under the same directory.

The Build phase's `methods/` files are procedure references, not dispatch templates. They have no signature pair because they are not dispatched.

---

## 5. State and observability

`pipeline.md` is the canonical workspace state, updated by `/weave` between phases. Phase agents write their own artifacts under `.loom/<project>/`.

Subagent transcripts land at `~/.claude/projects/<encoded-cwd>/<orchestrator-session>/subagents/agent-<uuid>.jsonl` with a sidecar `agent-<uuid>.meta.json` containing the `agentType`. The post-tool-use hook `orchestrator/lib/telemetry/tag-subagent-phase.py` writes a `.phase` sidecar tagging each subagent transcript with its lifecycle phase.

`orchestrator/lib/telemetry/transcript-harvest.py` walks one orchestrator session's `subagents/` directory and emits one row per dispatched subagent for `analyze.py`. Because all Loom subagents are depth-1 from `/weave` (see 1.1), the harvester sees every dispatched session. There is no hidden depth-2+ band.

Each row carries `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens`, `output_tokens`, and wall / autonomous duration. Multiply at base rates to estimate Anthropic spend:

```
cache_creation * 1.25  +  cache_read * 0.10  +  input * 1.00  +  output * 5.00   (USD per 1M tokens)
```

The Build phase is one row per dispatch; that row's `cache_read` carries the bulk of the work-loop's input cost.

---

## 6. What this architecture does not permit

Reject any proposal that requires these. They are not options; they are violations of the mechanics in section 1.

- A Build coordinator subagent that dispatches per-task subagents. Subagents cannot dispatch subagents (1.1).
- A "wave" of parallel task subagents dispatched from within a phase agent. Same reason.
- A persistent Build session that `/weave` sends additional turns to across phases. Sessions cannot be resumed (1.3).
- A custom cache breakpoint placed from inside the user-turn text. Cache breakpoints are SDK-controlled, not prompt-controlled.
- A way for `/weave` to read a phase agent's tool history mid-flight. The orchestrator only sees the RETURN message after completion (1.2).

Parallelism, when needed, lives only at the `/weave` level — one assistant turn dispatching multiple independent phase agents — and Loom does not currently use it because the five phases are inherently sequential.
