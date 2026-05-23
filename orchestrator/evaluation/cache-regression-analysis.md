# Cache regression analysis — v1 vs baseline

> **Resolved.** The Build phase is restored to a single-session dispatch
> shape (one `/weave` dispatch per Build phase entry; per-task work runs
> inline within that session). The mechanical rationale and the platform
> constraints that make this the only legal shape with within-session
> amortization are captured in `orchestrator/weave/lifecycle-architecture.md`.
> Sub-subagent dispatch — the path this analysis still considers in places
> below — is forbidden by Claude Code. Read this file as historical record;
> the source-of-truth for the current contract is `lifecycle-architecture.md`.

Investigation triggered by the observation that `490c8af` ("cache improvement")
appeared to **increase** `cache_create` and `cache_read` instead of reducing
them. The analysis below is grounded in `usage.jsonl`, raw subagent
transcripts under `~/.claude/projects/`, and the prompt-caching contract
documented at <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>.

## TL;DR

- The "cache improvement" commit `490c8af` is **not** the structural cause
  of the regression. The structural cause is **`98a9e26` ("phase 1")**, which
  restructured the Build phase three days earlier.
- `490c8af`'s autonomy-directive change is real but orthogonal: its
  benefit lands on the orchestrator's own session cache, which is **not
  measured** by `usage.jsonl` at all.
- On top of those mechanics, an LLM-orchestration variance in run
  `1779088275-1` flipped that run into the worst-case shape (11 build
  dispatches vs the other v1 run's 1).
- The genuine per-task cost increase between contract-following runs
  comes from **per-Coordinator round-trip file re-reads** + the
  **5-minute cache TTL** expiring between consecutive build dispatches.

## 1. Numbers, normalized

All six runs, depth-1 subagent totals (one row per `/weave`-dispatched subagent):

| Run | Loc | tasks | build dispatches | build cache_create | build cache_read | total cache_create | total cache_read |
|---|---|---:|---:|---:|---:|---:|---:|
| 1778963742-1 | baseline | 5 | 1 | 405k | 8.7M | 894k | 13.2M |
| 1778968525-1 | baseline | 10 | 1 | 133k | 11.4M | 483k | 16.8M |
| 1779002783-1 | baseline | 12 | 1 | 179k | 10.0M | 689k | 15.4M |
| 1779002783-2 | baseline | 10 | 1 | 558k | 25.8M | 1.26M | 34.7M |
| 1779046840-1 | v1 | 12 | 1 | 164k | 17.6M | 567k | 23.4M |
| 1779088275-1 | v1 | 5 | **11** | **1.41M** | **31.5M** | **1.83M** | **40.3M** |

Latest run is an outlier by a large margin — but only one of the two v1
runs is bad. Same code, same `baseline-answers.yaml`, two different
orchestration shapes.

## 2. The real structural change: `98a9e26`, not `490c8af`

`phases/build/phase.md` step 3 changed materially in `98a9e26`:

**Before** (`98a9e26~1`):

> **For each ready task, dispatch a fresh `Task` subagent running
> `methods/task.md`.** … per-task implementation work is exclusively the
> task subagent's responsibility

**After** (`98a9e26` and current):

> **Promote each ready task on `board.md` from `Backlog` to `In Progress`
> and return control.** Task subagents are dispatched by `/weave`, not
> by the Coordinator — every subagent in the Loom tree spawns from the
> orchestrator

This moved task fan-out from *inside* the Build Coordinator subagent up
to the parent `/weave` orchestrator. With the new contract, every task
generates **two** depth-1 dispatches (Coordinator round, then Task
Builder), plus one final Coordinator. For 5 tasks: 6 Coordinator + 5
Task Builder = **11 build dispatches** — exactly what `usage.jsonl`
shows for the latest run.

## 3. The harvester only sees depth-1 subagents — "before" was undercounted

`orchestrator/lib/telemetry/transcript-harvest.py:279-297` walks
`~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/` — only the
orchestrator's own subagents directory. Nested `Task` calls from inside
a subagent live under that subagent's own session dir and are **not
visible** to the harvester.

Under the old contract, when the Build Coordinator internally
dispatched 5–12 Task Builders, those per-task dispatches were billed by
Anthropic but invisible to `usage.jsonl`. The "1 build subagent, 405k
cache_create" in `1778963742-1` is a depth-1-only number — the real
per-task cost was happening offstage.

Part of the apparent regression is therefore an **observability
shift**: under the new contract, all dispatches are at depth 1 and
counted; we are now seeing what we could not see before. (Not all of
it — see §5.)

The script itself states this explicitly at lines 26–28:

> Orchestrator-side inference (the `/weave` session itself) is not
> emitted as a row — only dispatched subagents are.

## 4. The autonomy directive in `490c8af` doesn't touch the subagent cost path

`490c8af`'s diff to `orchestrator/evaluation/run-baseline.sh` injects
`--append-system-prompt "$AUTONOMY_PROMPT"` and replaces the
resume-loop with a single autonomous invocation. The theory of
improvement is: keeping the `/weave` orchestrator process alive across
all five phases keeps **the orchestrator's own** prompt cache warm.

But because `transcript-harvest.py` excludes the orchestrator session,
the entire benefit of the autonomy change lands in a cost band that
`usage.jsonl` does not measure. The subagent dispatches that *are*
measured each spin up fresh sessions either way — the autonomy
directive does not make them cheaper.

## 5. Within the post-`98a9e26` data, there is still a real extra-cost mechanism

Comparing the two v1 runs (both post-`98a9e26`):

- `1779046840-1` (12 tasks, 1 build dispatch): the LLM orchestrator that
  run apparently did not honour the new contract — it lumped the whole
  build into one Coordinator. cache_read per task ≈ 1.5M.
- `1779088275-1` (5 tasks, 11 build dispatches): contract-following.
  cache_read per task ≈ 6.3M.

The **4× per-task cache_read** is not visibility — both numbers are
depth-1-only and apples-to-apples. Two real drivers:

### 5a. Redundant prefix re-loading across subagents

Inspecting one build subagent transcript
(`agent-a298bf74b8509f9ae.jsonl`, the 2nd Coordinator dispatch):

| turn | cache_creation | cache_read |
|---:|---:|---:|
| 1  | 6,691 | 10,749 |
| 2  | 6,691 | 10,749 |
| 3  | 698   | 17,440 |
| 4  | 979   | 18,138 |
| 5  | 474   | 19,117 |
| …  | …     | … |
| 27 | 780   | 32,056 |

Within a single subagent, cache mechanics work as designed. The
problem is **across** subagents: each fresh Coordinator dispatch
re-reads `board.md`, `plan.md`, `tasks/T-NNN.md`, `develop-log.md` etc.
into its private context. Anthropic's cache is keyed on **workspace +
prompt-prefix hash** — the body+signature prefix matches across
dispatches, so its ~6.7k cache should be reused, but the file-reads
each subagent does land **after** the cached prefix in its own session
and get re-paid every dispatch.

### 5b. 5-minute TTL expiring between dispatches

The 11 build subagents' dispatch timestamps from `.phase` sidecars:

| # | Dispatched | Gap from prior |
|---:|---|---:|
|  1 | 07:30:44 | — |
|  2 | 07:36:01 | 5:17 |
|  3 | 07:41:09 | 5:08 |
|  4 | 07:46:49 | 5:40 |
|  5 | 07:51:53 | 5:04 |
|  6 | 07:59:03 | 7:10 |
|  7 | 08:03:39 | 4:36 |
|  8 | 08:06:45 | 3:06 |
|  9 | 08:11:24 | 4:39 |
| 10 | 08:17:14 | 5:50 |
| 11 | 08:22:18 | 5:04 |

Six of the eleven gaps are between 5:04 and 5:50 — sitting **just past
the 5-minute ephemeral cache TTL** documented in the Anthropic prompt
caching docs. The body+signature head that would otherwise hit cache
between consecutive Coordinator dispatches expires by a few seconds on
most of them. (Cache write = 1.25× base input; cache read = 0.1× base;
[Anthropic API pricing 2026](https://www.finout.io/blog/anthropic-api-pricing).)

## 6. Cost-band attribution

```
Apparent regression in usage.jsonl  =  visibility shift (§3)
                                    +  extra Coordinator round-trips per
                                       task — N extra board-only dispatches
                                       not present in the old contract (§2)
                                    +  redundant per-dispatch file reads
                                       inside each Coordinator (§5a)
                                    +  5-minute TTL miss between
                                       sequential dispatches (§5b)
                                    +  LLM orchestration variance (§5)

Effect of 490c8af on the above      =  none of the four cost bands
```

The `490c8af` autonomy change improves the orchestrator's own session
cache — invisible to `usage.jsonl`. Whether that translates to real
spend savings on the Anthropic bill is a separate question that this
metric cannot answer.

## 7. Open questions

- Whether Claude Code's `Task` tool inserts `cache_control` at the
  body+signature boundary that `weave/SKILL.md` §Conventions describes,
  or somewhere else. The SKILL.md text saying "the closing
  `</system-reminder>` line of the dynamic tail is the cached-prefix
  boundary" is ambiguous — that boundary location would put the
  dynamic tail *inside* the cache, which contradicts caching semantics
  for a prefix that varies per dispatch. The first-turn
  `cache_creation=6,691` in the inspected transcript is consistent
  with a small cached prefix that does not include all of body+signature
  — but the transcript JSONL does not surface the cache_control
  positions, so confirming requires inspection of the actual SDK
  request payload.
- Whether the Feb 2026 workspace-level cache isolation change affected
  anything in this comparison. All six runs sit on the same Anthropic
  workspace, so it should not, but an account-side migration cannot
  be ruled out from `usage.jsonl` alone.
- How sticky the "1 build dispatch" vs "11 build dispatches" split is.
  n=2 v1 runs is not enough to tell whether one shape is the norm and
  the other is variance, or whether they are roughly 50/50. The
  contract in `phase.md` clearly intends the 11-dispatch shape; the
  1-dispatch shape in `1779046840-1` is the contract-violating outcome
  the LLM chose.

## 8. Sources

- [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic API pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)
- [Subagents in the SDK](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Claude Code custom subagents docs](https://code.claude.com/docs/en/sub-agents)
