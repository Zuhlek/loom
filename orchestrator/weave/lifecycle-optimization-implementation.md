# Loom — Optimization Implementation Plan

**Purpose.** Bridge between the rollout plan (`lifecycle-optimization-rollout.md`, which is the *spec*) and actual code. Per-phase: the surfaces that get touched, the new components, the order of work inside the phase, and the implementer decisions you have to make.

**This is not code.** I haven't seen Loom's source layout. Component touchpoints are named abstractly (e.g., "dispatcher state machine", "subagent boot block") because the rollout plan is provider-agnostic where possible and code-level paths are yours to fill in. Where an external API is fixed (Anthropic `cache_control`, `enablePromptCaching`, `tool_search`, Batch API), shapes are concrete.

**Companion docs.**
- `lifecycle-concepts-toc.md` — what Loom is (1287 lines)
- `lifecycle-optimizations-research.md` — the technique catalogue (with maturity / layer tags)
- `lifecycle-optimization-rollout.md` — the rollout spec (P1–P32, Z1–Z9)
- *(this doc)* — the implementation guide

---

# Executive summary

**What we are doing.** Shipping ~32 atomic optimisation packages (plus 9 parked experimental ones) through Loom's eval harness, one at a time. Each package is gated through a Keep / Refine / Drop decision based on six observable metrics. The wave is designed to land **only the wins that pay**, not all of them.

**Why now.** Loom is currently incurring three compounding taxes — silent cache misses, output-token inflation, and over-tiered model use — that together likely represent a 2–4× cost overhead and ~30% latency overhead vs. an idealised baseline. Each tax is independently fixable; none requires re-architecting the lifecycle.

## What Loom looks like after the F/D wave (P1–P32) lands

The architectural changes, named at the level you would describe them to a new engineer joining the project:

1. **Loom can measure its own cost.** Six telemetry deliverables (D1–D8) attribute every token to phase / subagent / task / model. Eval-harness variance is published so optimisation thresholds aren't coin-flips. A ground-truth Review-findings file persists so quality regressions get caught at gate-time.
2. **Loom's prompt cache actually hits.** Stable-prefix serialisation, four-breakpoint TTL layering, dynamic data shoved to a tail block. Cache-hit ratio rises from whatever it is today to ≥70% target. Subagent cache audit closes the SDK-default bug if it exists.
3. **Loom's outputs are economical by contract.** Per-subagent `max_tokens` caps, "be concise" prompts, JSON-schema-constrained decoding for structured outputs, return-by-reference (IDs not pasted content) enforced through the typed RETURN schemas Loom already has.
4. **Loom uses the cheapest model that does the job.** Haiku for the Coordinator + board mutations; Sonnet for Spec/Design/Build workers; Opus only for explicit reasoning gates and retry-3 escalation. Selective extended thinking (`budget_tokens`) on architectural decisions only.
5. **Loom skips the LLM when rules can decide.** Deterministic pre-agent shell prefetch (git diff, ls, lint) runs before subagent invocation. Skip-LLM relevance gates on Review prevent unnecessary subagent kicks. Tool-search hides long tool catalogues.
6. **Loom dispatches in parallel and in batch.** Audit confirms concurrent fan-out of ready tasks; AFK-classified tasks route through Anthropic Batch API at 50% off.
7. **Loom hands artifacts by reference.** Subagents read `read_artifact(US-NNN)` on demand instead of receiving inlined spec/design/plan content. Phase boundaries pass typed handoff schemas, not blob summaries.
8. **Loom retries intelligently.** Retry-2 carries a reflection summary forward; retry-3 escalates a tier; partial state survives across retries so the cost-per-retry drops.
9. **Loom caches deterministic tool results.** Content-addressed file reads, web-fetch / test-result memoisation. Semantic cache (P31) is gated as higher-risk and may be parked.
10. **Loom streams user-facing output.** TTFT on Spec/Design narrative drops materially. Non-user phases stay non-streamed.

## New infrastructure being introduced

What is genuinely net-new (not just configuration changes):

| New thing | Phase | Why it's significant |
|---|---|---|
| Telemetry pipeline + 8 deliverables | A | Foundation everything else evaluates against |
| Tool-call wrappers (file-read, web, test) | H | Content-addressed caching middleware |
| `read_artifact(id)` MCP tool | G.1 | Loom's stable IDs become a first-class retrieval primitive |
| Compactor subagent (phase-boundary) | G.4 | New typed handoff between phases |
| LLMLingua-2 pre-compressor service | G.4 | A running service with a loaded encoder model |
| Sandboxed code-execution tool | G.4 | MCP "skill" pattern — script-as-tool |
| Redis + embedding store (if P31 keeps) | H | Higher risk; may be parked |
| Batch API result-poller | F | Async dispatch for AFK tasks |

## The hidden bug surface (things we may discover, not fix)

Two packages exist to verify properties that *should* already be true. If they fail, real work surfaces:

- **P5 (subagent cache audit).** One-shot probe before scheduling. If Loom dispatches via Claude Code's Task tool with sane defaults, P5 collapses to a one-line assertion. If Loom uses Anthropic Agent SDK directly with `enablePromptCaching: false` defaults, P5 is real and high-value.
- **P11 (coordinator transcript-content audit).** Verifies that concepts §8's "Coordinator has only Bash + atomic-write" claim holds in code. If yes, P11 is documentation. If no, a real fix package is filed and gated separately.
- **P17 (parallel fan-out audit).** Verifies §11.B's claim that ready tasks dispatch concurrently. If serial, becomes a real fix.

**Recommend doing all three audits before P1 ships** — they shape downstream package scope.

## Decision points for you (the user)

These are calls only you can make, not me:

1. **How many packages do we actually ship?** The plan covers 32 + 9. A reasonable stopping point is "P1–P19 (the first wave), evaluate, decide whether the remaining ~13 main-wave items are worth pursuing." The Park (Z1–Z9) almost certainly shouldn't ship in this campaign.
2. **Does P31 (semantic cache) ship at all?** Higher risk, persistent infra (Redis + embeddings), silent quality regression failure mode. Default recommendation: **park it** unless P29 + P30 don't deliver the cost target.
3. **Does P27 (LLMLingua-2) ship?** It is a running service with a loaded model — meaningful infra. Worth it if Loom has phases ingesting >10K-token docs. If most subagents already get ID-resolvable artifacts (P19), P27 may have small headroom.
4. **D5 ground-truth scope.** P1's ground-truth Review-findings file is the gate for several quality bars (P15, P23). It is the most under-specified deliverable in the plan because *only you know the baseline project*. Decide: which project, who runs the full-Review pass, where the file lives.
5. **Multi-provider strategy.** Most cache packages assume Anthropic-native primitives. If Loom plans to multi-provider route within 6 months, P2–P5 and P16 / P18 need provider-specific variants — adds ~30% scope.
6. **Audit-first vs. ship-first.** I recommend running P5/P11/P17 audits in week 1 before any optimisation work. Some implementers prefer to ship in order; let me know.

## What is deliberately deferred

Anything in the Park section (Z1–Z9). Specifically:
- All hierarchical memory subsystems (MemGPT, Cosmos, trained compactor) — too much new infrastructure for marginal expected gain over P24/P25.
- Speculative-execution research (PASTE, speculative actions) — research-stage, complex reversibility.
- Mixture-of-Agents and RouteLLM — quality / cost gains exist but at significant build cost; revisit if P23 cascade doesn't close the Review-cost gap.
- Request hedging — only if tail-latency is a measured pain point.
- KV-cache sticky routing — only if Loom self-hosts.

## Total scope at a glance

| Phase | Packages | Expected effort | Risk |
|---|---|---|---|
| A — Telemetry | 1 | Med (8 deliverables, but small each) | Low |
| B — Cache hygiene | 4 | Low | Low — but P5 may collapse to assertion-only |
| C — Output economy | 4 | Low | Low (mostly SKILL edits + config) |
| D — Routing & gating | 4 | Low-Med (P10's precision/recall harness is the work) | Low-Med |
| E — Deterministic shortcuts | 3 | Low-Med | Low |
| F — Dispatch | 2 | Low (P18 batch poller is the work) | Low |
| G — Context compression + retries + Review | 10 | High (heterogeneous; G.1 + G.4 are real building) | Med (semantic-quality risks) |
| H — Tool-result caching | 3 | Med (MCP wrappers + caches) | Med (P31 silent regression risk) |
| I — Latency UX | 1 | Low | Low |
| Park (Z) | 9 | High (deferred) | High (deferred) |

**Recommendation:** Approve Phases A–F outright. Treat Phase G as "approve in principle, decide per-sub-phase as we ship". Defer Phase H's P31 to a separate gate. Phase I is trivial. Park stays parked.

---

# How to read each phase plan

Each phase below uses the same shape:

> **Outcome.** What Loom can do after this phase that it couldn't before.
> **Packages.** P_n, P_n+1, … in ship order.
> **Component touchpoints.** Loom surfaces that get edited.
> **New components / services / dependencies.** Anything net-new.
> **External dependencies / APIs.** Vendor surfaces.
> **Sequence of work within the phase.** Numbered steps.
> **Key implementer decisions.** Calls the engineer doing the work will face.
> **Definition of done.** What "phase complete" means.
> **Risks specific to this phase.** Anything that needs eyes-on.

Phase plans deliberately do *not* repeat the per-package rollout spec — that is the source of truth in `lifecycle-optimization-rollout.md`. This doc adds the *build view*.

---

# Phase A — Telemetry foundation

**Outcome.** Every API call attributable to a phase, subagent, task, and model. Eval-harness variance is published; ground-truth Review-findings file persisted; cache-warming protocol selectable per eval run; intra-session model-switch alarm wired. No optimisation is evaluable until A is done.

**Packages.** P1 (the eight deliverables D1–D8).

**Component touchpoints.**
- API-call wrapper / dispatcher entry point — add structured tags (`phase`, `subagent`, `task_id`, `model`) to every outbound call.
- Eval harness — extend to N=5 repeated runs against an unchanged baseline, compute σ per metric, persist as `baseline-variance.json`.
- Review skill — run once with all skip-LLM gates disabled and all cascade thresholds set to "always escalate" to produce the ground-truth findings file.
- Logging sink — wire OpenTelemetry GenAI semantic conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read_input_tokens`, `gen_ai.usage.cache_creation_input_tokens`).
- Dispatcher session-state — emit a model-switch event when a single subagent thread's `model` field changes between calls.
- Dashboard backend — Grafana/Datadog/Honeycomb/Langfuse; only one needed.

**New components / services / dependencies.**
- `baseline-variance.json` — generated artifact, not infra.
- `baseline-review-findings.json` — generated artifact.
- Cache-warming runner — three modes (Cold flushes session + waits past TTL; Warm runs 3 priming evals; Steady-state runs 5 + averages last 3).
- Dashboard — pick one stack and stick to it.

**External dependencies / APIs.**
- OpenTelemetry GenAI semantic conventions (vendor-neutral spec).
- Anthropic `usage` block fields on every response (no API change — already returned).

**Sequence of work within the phase.**
1. Add the API-call wrapper with structured tags. Verify telemetry is emitted on a known endpoint.
2. Wire OpenTelemetry GenAI conventions. Confirm dashboard receives spans with cache + usage fields.
3. Build the cache-warming runner (Cold/Warm/Steady-state). Smoke-test all three modes.
4. Run baseline eval N=5 against unchanged code. Compute σ per metric. Persist `baseline-variance.json` and publish σ values into team chat — every later threshold references these.
5. Run full-Review-no-gate pass on baseline project. Serialise findings as `baseline-review-findings.json`.
6. Wire model-switch detector — dispatcher emits an event whenever a single thread sees a model change between consecutive calls; dashboard alarms on count > 0 over rolling 24h window.
7. Add cost-distribution healthcheck alarm: coord/worker token ratio >15% triggers warning (Augment's 9.8% / 70.6% as the reference shape).

**Key implementer decisions.**
- Which dashboard backend. Langfuse and Honeycomb both work well for this shape. Stick to one.
- Where `baseline-variance.json` and `baseline-review-findings.json` live (repo, S3, internal blob store).
- Cache-warming Cold mode: does it actually wait past 5-min TTL (slow), or does it use a different API key / fresh session to force prefix re-creation? The latter is faster but verify it actually defeats the cache.

**Definition of done.**
- Dashboard renders per-phase / per-subagent attribution for the six-metric stack.
- σ published for every metric.
- Ground-truth file captured.
- Cache-warming runner exercisable.
- Model-switch detector emits zero events on baseline run (or non-zero is investigated).
- Instrumentation overhead measured at <2% wall-clock.

**Risks specific to this phase.**
- **Instrumentation overhead exceeds 2%.** If the OpenTelemetry exporter is synchronous, it can; switch to batch async exporter.
- **σ is huge.** If baseline variance is >10% on token metrics, the eval harness is too noisy and several downstream thresholds become unreachable. Possible causes: non-deterministic tool ordering, retry-triggered phantom calls, time-of-day API performance variance. Investigate before P2 ships.

---

# Phase B — Cache hygiene

**Outcome.** Prompt cache actually hits ≥70% on Warm-mode runs across all subagents. The biggest single cost lever in the wave.

**Packages.** P2 (prefix lockdown), P3 (1h TTL), P4 (4-breakpoint layering + tail safety), P5 (subagent cache audit + boot-block pre-warming).

**Component touchpoints.**
- Tool-schema serializer — deterministic key order, frozen tool order. The JSON your code emits must be byte-identical across runs for the same logical tool set.
- SKILL prompts (all five phases) — strip dates, UUIDs, timestamps, conversation IDs, request IDs from the system prompt. Move all dynamic data into a tail block of the *user* turn.
- API call construction — add `cache_control` to four breakpoints (tools, system+skills, phase context, task context); 1h TTL on outermost, 5m on inner; add a fifth safety breakpoint near the live tail on long sessions.
- Subagent boot dispatcher — ensure `enablePromptCaching: true` and explicit `cache_control` on the boot env block (if Anthropic Agent SDK is the path; verify in pre-investigation).
- Phase-boundary hook — fire `max_tokens=1` call to warm the next phase's static prefix.

**New components / services / dependencies.**
- Lint rule: any system-prompt template containing a date/UUID/timestamp pattern fails CI.
- Pre-investigation script for P5 — one-shot probe that inspects a subagent kick's actual request payload.

**External dependencies / APIs.**
- Anthropic `cache_control` blocks with `type: "ephemeral"` and `ttl: "5m" | "1h"`.
- Anthropic Agent SDK `enablePromptCaching` flag (if used).

**Sequence of work within the phase.**
1. **Pre-investigation (P5 gate)** — instrument one subagent kick, inspect its request payload. Confirm or deny `enablePromptCaching: true` and `cache_control` presence on the boot env block. **This output decides whether P5 is real or assertion-only.**
2. **P2 — Prefix lockdown.** Audit every SKILL prompt for dynamic content; relocate. Write the deterministic serializer for tool schemas. Add lint rule. Ship as one commit.
3. **Eval P2.** Run both Cold and Warm mode. Cache-hit ratio (Warm) should jump materially.
4. **P3 — 1h TTL on outermost breakpoint.** Single config flip.
5. **Eval P3.** Steady-state run with idle gaps; `cache_creation_input_tokens` per subagent should drop.
6. **P4 — Four-breakpoint layering + tail safety breakpoint.** Add the three inner breakpoints + one near the live tail.
7. **Eval P4.** Inner-churn runs preserve outer-prefix cache hits; long-session runs don't fall off the 20-block lookback cliff.
8. **P5 — Conditional.** If pre-investigation showed the bug exists, fix it (flip flag, add boot-block `cache_control`, add phase-boundary pre-warming hook). If not, document the assertion and move on.

**Key implementer decisions.**
- Where dynamic data lives in the user turn. Suggestion: a single `<system-reminder>` block right before the actual user message, identical structurally to how Claude Code itself does it (see harness reminders in our own conversation).
- Sort order for tool JSON: alphabetical by key name? By tool name? Either works; pick one and document.
- Whether to lock cross-session model selection now (related to D8 model-switch detector) — if Loom occasionally switches Sonnet → Opus mid-session, the cache discipline is undone. Make a policy call.

**Definition of done.**
- Cache-hit ratio (Warm) ≥ 70% across all subagents averaged.
- σ-bounded measurement: at least 3σ above pre-P2 baseline.
- No quality regression on the ground-truth Review-findings diff.

**Risks specific to this phase.**
- **Hidden dynamic content in shared SKILL templates.** A helper function that injects `datetime.now()` into the system prompt destroys cache silently. The lint rule catches obvious cases; subtle ones (a function calling a function calling `time.time()`) may slip through. P2 eval will catch them — if cache-hit ratio doesn't move ≥3σ, hunt for the leak before re-shipping.
- **P5 ambiguity.** If Loom dispatches subagents through multiple paths (some Anthropic SDK, some Claude Code Task tool, some custom), the pre-investigation may show "yes for some, no for others". Document and fix each path.

---

# Phase C — Output economy

**Outcome.** Total output tokens per project drop ≥3σ above noise. Coordinator inbox drops ≥20%.

**Packages.** P6 (`max_tokens` discipline), P7 (be-concise SKILL pass), P8 (constrained JSON decoding), P9 (return-by-reference enforcement).

**Component touchpoints.**
- Dispatcher subagent config — per-subagent `max_tokens` map. Roughly: classifier 5, kanban mutator 200, narrative per-phase tuned (Spec/Design 4000, Build 2000, Review 8000).
- All SKILL prompts — insert "no preamble, no filler, ≤N words, data only" near the top.
- Subagent dispatcher — flag `response_format: { type: "json_schema", schema: ... }` for structured-output subagents (kanban mutators, classifiers).
- Typed RETURN schemas — audit and tighten: `evidence: ["US-014", "T-031"]` not `evidence: "the user-stories US-014 and T-031 are satisfied because…"`.

**New components / services / dependencies.**
- Truncation alarm: dispatcher emits an event if a subagent's RETURN is structurally incomplete (schema-invalid). Feeds the P6 quality bar.
- Schema validator (if not already present) — checks every RETURN payload against its declared schema.

**External dependencies / APIs.**
- Anthropic native structured-output / JSON-schema decoding (Claude 4 family).
- Anthropic `max_tokens` per-request parameter.

**Sequence of work within the phase.**
1. **P6 — `max_tokens` map.** Set caps per subagent role. Ship. Eval.
2. **Truncation monitor.** Watch for schema-invalid RETURNs. If P6's caps were too tight, Refine upward (don't Drop the technique).
3. **P7 — SKILL pass.** Add the concise tax to every SKILL. Ship. Eval (≥3σ above P6 baseline).
4. **P8 — Constrained JSON.** Identify which subagents have JSON-shaped RETURN. Flip them to schema-constrained decoding. Verify token cost doesn't *rise* (constrained decoding can be more verbose for some schemas).
5. **P9 — Return-by-reference audit.** Read every RETURN schema. Find any free-text "content" or "summary" field that could be an ID. Tighten the schema to disallow inlined content. Update SKILL prompts to instruct subagents to cite IDs.

**Key implementer decisions.**
- Per-subagent `max_tokens` values. Suggestion: log p95 output length for each subagent over a baseline run, set cap to p99 + 20%.
- For P8: which subagents get JSON-schema decoding. Recommend: every subagent whose RETURN is parsed as JSON downstream (no exceptions; if it's parsed as JSON, constrain it).
- For P9: how strict to be. Recommend: a schema-validator rule that *rejects* any RETURN where a field accepts strings >50 chars when an ID would do.

**Definition of done.**
- Aggregate output tokens ↓ ≥15% (or ≥3σ) vs pre-C baseline.
- Coordinator inbox ↓ ≥20%.
- Parse-retry rate ↓ ≥80% on JSON-shaped subagents.
- Zero truncation incidents at the chosen caps.

**Risks specific to this phase.**
- **P7 quality regression.** "Be concise" can over-clip Spec/Design narrative output that the user reads. Quality bar: ground-truth Review diff should be empty.
- **P8 token inflation.** Constrained JSON occasionally costs *more* tokens than free text (schema forces verbose field names + structure). Check eval, not assumption.

---

# Phase D — Routing & gating

**Outcome.** Coordinator runs on Haiku at ≥99% precision/recall vs Sonnet reference. Workers run on Sonnet/Opus with explicit tier assignment per phase. Extended thinking is selective.

**Packages.** P10 (coord on Haiku), P11 (transcript-content audit), P12 (worker tier routing), P13 (selective extended thinking).

**Component touchpoints.**
- Dispatcher per-subagent model config — currently presumably global or per-phase; refactor to per-subagent-role.
- Reference-run harness — for each baseline run, capture every board mutation Coordinator emits, store as ground-truth diff target.
- Concepts §8 audit script (P11) — read tool grants of every dispatcher path, confirm Coordinator has only Bash + atomic-write.
- Per-phase config — extended thinking `budget_tokens` flag.

**New components / services / dependencies.**
- Coordinator precision/recall measurement harness — runs Haiku-coord and Sonnet-coord on the same baseline input, diffs the board-mutation logs. Requires reproducible input replay (every subagent's RETURN payload from a prior run, replayed against both coordinators).
- Audit script for P11.

**External dependencies / APIs.**
- Anthropic model identifiers: `claude-haiku-4-5-...`, `claude-sonnet-4-6`, `claude-opus-4-7`.
- Extended thinking `budget_tokens` parameter.

**Sequence of work within the phase.**
1. **P11 audit (do this first; gates rest of D).** Read tool grants for every dispatcher path. Verify §8 holds. If violated, file fix package separately. If yes, P11 is documentation-only.
2. **Build the precision/recall harness for P10.** Need ability to replay a stored sequence of subagent RETURN payloads against two coordinator configurations and diff the resulting board-mutation logs.
3. **P10 — Coord on Haiku.** Single config flip per the new per-subagent model config. Ship. Run precision/recall harness with N≥5 baseline runs (or one baseline run × 5 replays). Verify ≥99% precision and recall.
4. **P12 — Worker tier routing.** Set Sonnet for Spec/Design/Build workers, Opus for Review and explicit hard-gate subagents. Ship. Eval cost drop AND re-run P10's precision/recall harness (co-eval set declaration) to confirm Haiku-coord still passes against the new worker mix.
5. **P13 — Selective extended thinking.** Default `budget_tokens` off. Turn on for: Plan dependency-graph generation, Review architectural-gate verdicts. Eval thinking-output drop without architectural-finding regression.

**Key implementer decisions.**
- Per-subagent role granularity. If Loom currently has model config at phase-level only, the refactor to per-role is the real work — not the model assignment itself.
- For P10 precision/recall: what counts as a "mismatch"? A board mutation has multiple fields (target column, target task, blocked_by edge, autonomy class); does any field difference count, or only the dispatch-shape (which subagent, which task)? Suggest: shape-only for v1; field-level for follow-on tightening.
- For P13: which `budget_tokens` value. Start at 1024 (the minimum) and only raise on observed quality regression.

**Definition of done.**
- Coordinator cost ↓ ≥50%.
- Haiku-coord precision/recall ≥99% across N≥5 baseline runs.
- Total project cost ↓ ≥40% from pre-D baseline.
- Thinking-output ↓ ≥30%.
- Zero new Blockers, ≤1 new Major across all D packages.

**Risks specific to this phase.**
- **Replay harness is non-trivial.** Recording and replaying the input to the Coordinator (a stream of typed RETURN payloads from workers) requires that worker outputs be deterministic enough to capture-once-replay-many. If workers themselves are nondeterministic, replay diverges. Workaround: run both coordinators *live* on the same project, take the diff at session end — slower but no replay machinery.
- **Haiku silently downgrades on subtle tasks.** The precision/recall harness catches diffs *at the moment they happen*. If Haiku miscategorises one task in 200, the eval may need wider coverage than one baseline project.

---

# Phase E — Deterministic shortcuts

**Outcome.** Subagents skip work that doesn't need an LLM. Tool catalogues don't bloat the prefix.

**Packages.** P14 (pre-agent shell prefetch), P15 (skip-LLM gate on Review), P16 (tool-search deferred loading).

**Component touchpoints.**
- Dispatcher pre-step hook — before invoking a subagent, run a configured set of shell commands and pass output as bounded text in the prompt.
- Review skill — rule file (YAML or similar) declaring per-finding-type file-glob filters that suppress the subagent kick.
- Subagent boot prompt — replace inline tool definitions with `tool_search` for any subagent with >5 declared tools.

**New components / services / dependencies.**
- Shell-prefetch runner — runs deterministic commands, captures output, formats as a fenced block in the subagent prompt. Per-subagent config of which commands to run.
- Review-gate rule file — declarative format mapping finding types to required-touch path patterns. Falls back to "always fire" if no rule matches.

**External dependencies / APIs.**
- Anthropic `tool_search` tool.

**Sequence of work within the phase.**
1. **P14 — Build the shell-prefetch runner.** Identify which subagents currently discover context via tool calls; configure the corresponding shell pre-step for each. Ship. Eval input-token drop and tool-call-count drop.
2. **P15 — Build the Review-gate rule file.** Start with the easy cases (security-review only on auth/* paths, perf-review only on hot-path files). Use D5 ground-truth as the safety check — every Blocker in D5 must remain catchable. Ship. Eval Review call-count drop AND zero missed Blockers.
3. **P16 — Tool-search.** Identify subagents with >5 tools. Flip to `tool_search`. Pre-seed the most-commonly-used 2-3 tools so they're always in context; defer the rest. Ship. Eval tool-context-token drop; verify no "tool not found" failures. **Co-eval P2 cache-hit ratio** since tool list changed.

**Key implementer decisions.**
- For P14: which shell commands per subagent. Recommend a config file rather than hard-coding into dispatcher.
- For P15: how aggressive are the gates. Recommend conservative — only skip when *both* file-scope and finding-type match the rule unambiguously.
- For P16: which tools to pre-seed. Recommend: pre-seed tools called in >50% of subagent runs across the baseline (from P1 telemetry).

**Definition of done.**
- Per-subagent input ↓ ≥15% on subagents with shell prefetch.
- Review call count ↓ ≥25% with zero missed Blockers / zero missed Majors.
- Tool-context tokens ↓ ≥50% on tool-heavy subagents.
- P2 cache-hit ratio still ≥70% after P16 lands (re-warm + re-measure).

**Risks specific to this phase.**
- **P15 rule rot.** As Loom's codebase grows, file-glob rules need updating. If a new sensitive path is added without a rule, Blockers slip. Solution: D5 ground-truth diff in CI catches this — every release diffs against a freshly re-captured ground truth.

---

# Phase F — Dispatch

**Outcome.** Build phase actually fan-outs in parallel. AFK tasks ride the 50% Batch discount.

**Packages.** P17 (parallel fan-out audit), P18 (Batch API for AFK tasks).

**Component touchpoints.**
- Build dispatcher — verify (P17) and possibly fix concurrent dispatch logic.
- AFK task router — new component that intercepts AFK-classified tasks, batches them through Anthropic Message Batches API, polls for results, threads results back into the kanban.

**New components / services / dependencies.**
- Concurrent-dispatch metric — eval harness reports "tasks dispatched concurrently" as a counter so regression is visible.
- Batch poller — async loop that polls Anthropic Batch API for completion, retrieves results, dispatches to downstream phase handlers.

**External dependencies / APIs.**
- Anthropic Message Batches API (POST `/v1/messages/batches`, GET to poll).
- Idempotency keys per batch entry.

**Sequence of work within the phase.**
1. **P17 audit.** Instrument the dispatcher to log every "ready_task → dispatch" event with timestamp. Run baseline build. Verify ready tasks fire concurrently. If serial, file fix package and remediate.
2. **Build the Batch poller.** Identify AFK-class tasks in the plan. Build the routing logic: AFK tasks → Batch API submission → poll → result handling. Ensure idempotency (don't re-submit a batched task if Loom restarts mid-poll).
3. **P18 — Ship Batch API routing for AFK tasks.** Eval cost drop on AFK tasks (~50%) and SLO compliance.

**Key implementer decisions.**
- Batch poll interval. Anthropic's SLA is 24h; most complete in <1h. Recommend 5-minute poll initially.
- Idempotency strategy. Recommend: store batch IDs in `.pipeline` so a restart can resume polling rather than re-submitting.
- Result-injection point. AFK tasks complete asynchronously — the kanban needs a path to receive their results out-of-order from when they were dispatched.

**Definition of done.**
- Build-phase wall-clock matches theoretical parallel lower bound (sum of longest DAG path).
- AFK-task cost ↓ ~50%; SLO held.

**Risks specific to this phase.**
- **P18 result-injection breaks invariants.** If the kanban assumes synchronous task completion (e.g., "next dispatch happens after this one returns"), Batch's async return breaks it. Verify the dispatcher's state machine handles out-of-order returns before shipping P18.

---

# Phase G — Context compression, retries, Review cascade

This phase is heterogeneous — three sub-groups inside G. Treating each as its own mini-phase.

## G.1 — Pass-by-ID (P19)

**Outcome.** Subagents read artifacts on demand instead of receiving them inlined.

**Component touchpoints.**
- MCP tool registry — add `read_artifact(id)` tool that resolves `Q-NNN / US-NNN / T-NNN` to artifact content.
- All SKILL prompts (subagent-side) — replace inlined spec/design/plan sections with "use `read_artifact(...)` if you need the full text of US-NNN".
- Subagent tool grants — add `read_artifact` to the grant list.

**New components / services / dependencies.**
- `read_artifact` MCP tool — backed by Loom's artifact store (probably the existing file-based artifact directory).

**Sequence of work.**
1. Build `read_artifact` MCP tool.
2. Add to subagent tool grants.
3. Audit every SKILL for inlined artifact content; replace with the directive.
4. Ship; eval input-token drop; **co-eval P2 cache-hit ratio** (tool-list change perturbs cache).
5. If P16 already shipped, eval tool-search behaviour (does `read_artifact` get pre-seeded or deferred?).

**Risks.**
- **Subagents fail to dereference.** If a subagent skips the `read_artifact` call and tries to act on the ID alone, quality regresses. Quality bar: D5 diff catches this. Mitigation: make the tool prominent in the SKILL prompt.
- **`teardown` rollback complexity.** Reverting requires dereferencing any in-flight task's ID references before removing the tool. Procedure is in the rollout doc.

## G.2 — Retry intelligence (P20, P21, P22)

**Outcome.** Retries are smarter and cheaper.

**Component touchpoints.**
- Dispatcher retry state machine — carry forward `previous_attempt_failure_summary` between attempts; escalate model tier on attempt 3; preserve succeeded-step state across retries.
- Retry SKILL prompt — instruct subagent to read the failure summary.

**Sequence of work.**
1. **P20 — Reflection block.** Define the `failure_summary` schema (cause, attempted fix, blocker). Modify dispatcher to extract failure summary from attempt N's transcript and pass into attempt N+1. Update retry SKILL.
2. Eval first-attempt success rate unchanged, retry-2 success rate ↑.
3. **P21 — Escalation.** Modify dispatcher to switch model tier on retry-3. Requires P12 already shipped (Opus tier wired).
4. Eval retry-3 success ↑ vs P20 baseline. Co-eval P20.
5. **P22 — Partial state.** Modify dispatcher to preserve succeeded-step outputs. On retry, re-invoke only the failed step with diff context.
6. Eval cost-per-retry ↓ ≥30%; P20/P21 success rates unchanged. Co-eval P20, P21.

**Risks.**
- **Reflection leakage into attempt 1.** If `failure_summary` is appended unconditionally, even first attempts see it (and may hallucinate failures). Dispatcher must scope the block to N≥2.
- **Stale state on partial retry.** If retry-3 picks up partial state but an upstream change invalidated it, results are wrong. Implement a hash-based staleness check; on stale, fall back to full re-run.

## G.3 — Review cascade (P23)

**Outcome.** Review uses Haiku for cheap lint, escalates to Sonnet on findings, Opus on architectural-class.

**Component touchpoints.**
- Review skill — rewrite as a multi-pass: pass-1 (Haiku) emits a finding-count and severity-distribution; pass-2 (Sonnet) runs only on flagged areas; pass-3 (Opus) runs only on architectural-class findings.

**Sequence of work.**
1. Define escalation thresholds. Recommend: Haiku flags any finding → Sonnet escalation; Sonnet flags `severity in {Blocker, Major}` AND class in {architectural} → Opus.
2. Rewrite Review skill as the multi-pass. Preserve the existing finding schema.
3. Ship; eval cost drop ≥40%; co-eval P15 (skip-LLM gate); D5 diff zero on Blockers/Majors.

**Risks.**
- **Haiku misses architectural class.** Quality bar: D5 diff catches this; if even one Major is missed, lower escalation threshold (Refine, not Drop).

## G.4 — Active compression infra (P24, P25, P26, P27, P28)

**Outcome.** Long-running phases stay bounded; doc-heavy phases get compressed; multi-tool subagents script-as-tool.

**Component touchpoints.**
- New compactor subagent (P24) — runs at phase boundary; consumes the prior phase's transcript; emits a typed handoff blob.
- Typed handoff schema (P25) — `{intent, changes_made, decisions, open_questions, next_steps}`.
- AST retrieval layer for Build (P26) — tree-sitter parse + import graph slicing.
- LLMLingua-2 pre-compressor service (P27) — running service; pre-processes doc-heavy subagent inputs.
- Sandboxed code-execution tool (P28) — MCP tool that runs a generated script in an isolated environment and emits only the script's stdout/return.

**New components / services / dependencies.**
- Compactor subagent — needs its own SKILL, RETURN schema, dispatch path.
- LLMLingua-2 service — Docker/sidecar; loads encoder model; exposes HTTP endpoint.
- Sandbox runner — likely a sandboxed Python/Node executor (Pyodide, deno-deploy, micro-VM).
- Tree-sitter integration — language-grammar files per language Loom supports.

**Sequence of work.**
1. **P24 — Compactor.** Build the subagent; define the blob-summary RETURN. Insert into phase-boundary dispatch. Eval handoff-size cap held; D5 diff zero.
2. **P25 — Typed handoff.** Replace blob-summary with structured schema. Co-eval P24.
3. **P26 — AST retrieval.** Integrate tree-sitter. Implement slicing logic (import-graph + call-graph based). Eval code-context-token drop on Build subagents.
4. **P27 — LLMLingua-2.** Deploy service. Wire as pre-processor in front of doc-ingesting subagents. Eval input-token drop. **`teardown` rollback class — service decommission procedure documented in rollout.**
5. **P28 — Code-execution-as-tool.** Build sandbox; expose as MCP tool. Train (via SKILL prompt) subagents to generate scripts that filter-then-return rather than directly calling N tools.

**Key implementer decisions.**
- For P25 schema fields: which fields are mandatory vs optional. Recommend mandatory: `intent`, `decisions`. Optional: `open_questions`, `next_steps`.
- For P26: which languages tree-sitter supports vs which Loom needs. Plan for the supported subset; fall back to regex retrieval for unsupported languages.
- For P27: where the service runs. Sidecar in the same pod is simplest; standalone service is cleaner; serverless function works for low-volume cases.
- For P28: sandbox technology. Pyodide for Python-only is simple; firecracker micro-VM is more flexible but heavier. Recommend Pyodide-or-equivalent for v1.

**Risks specific to G.4.**
- **Compactor introduces knowledge gaps.** If the typed handoff schema is missing a category Loom needs (e.g., "rejected design alternatives"), downstream phases lose information. Quality bar: D5 diff catches it; Refine the schema.
- **LLMLingua-2 over-compresses.** Compression ratio too aggressive → quality regression. Tune the compression target rate downward.
- **Sandbox escape.** A code-execution tool that escapes its sandbox is a security incident, not a token-cost regression. Strict sandbox; explicit allow-list of executable operations.

**Definition of done for full Phase G.**
- Subagent input ↓ ≥30% (P19).
- Retry cost-per-attempt ↓ ≥30% (P22); retry success rate ↑ ≥10pp/15pp (P20/P21).
- Review cost ↓ ≥40% (P23).
- Phase-boundary handoff size capped (P24/P25).
- Code-context tokens ↓ ≥40% on Build (P26).
- Doc-ingesting subagent input ↓ ≥50% (P27).
- Tool-output tokens ↓ ≥60% on multi-tool subagents (P28).
- No quality regression across the phase.

---

# Phase H — Tool-result caching

**Outcome.** Deterministic tools never run twice on the same input.

**Packages.** P29 (content-addressed file-read), P30 (web-fetch / test-result memoisation), P31 (semantic cache).

**Component touchpoints.**
- MCP middleware / tool wrapper layer — intercept tool calls, check cache, return cached result if hit.
- Cache store — content-addressed on-disk store keyed by hash. Separate store per cache type.
- Embedding service (P31 only) — embeds incoming sub-questions; checks Redis for nearest neighbour above threshold.

**New components / services / dependencies.**
- File-read cache store (P29) — keyed by `(path, sha256)`.
- Web-fetch cache (P30) — keyed by `(url, etag)`.
- Test-result cache (P30) — keyed by `(command, input-hash, commit-sha)`.
- Semantic cache (P31) — Redis + embedding model. Only if shipped.

**External dependencies / APIs.**
- For P31: an embedding model (Voyage AI, Cohere, OpenAI text-embedding-3-small, or local).
- Redis (or equivalent) for P31's cache store.

**Sequence of work.**
1. **P29 — File-read cache.** Build the MCP wrapper. On read: hash file; if hash in cache, return "unchanged" sentinel; else return diff. Ship. Eval read-token drop.
2. **P30 — Web/test memoisation.** Same shape as P29 with different keys. Ship. Eval Review-phase re-run cost drop.
3. **P31 (decision point — may park).** Decide whether to ship semantic cache. If yes: deploy Redis, deploy embedding service, build the wrapper for read-mostly subagents (classifiers, routers). Sample N=100 cache hits; verify FP rate <3%.

**Key implementer decisions.**
- For P29: cache invalidation. Recommend hash + mtime as the key (mtime as fast-path; hash as definitive).
- For P30 test-result cache: what counts as the same command. Recommend canonicalising flags/env-vars; not just literal string match.
- **For P31: ship or park.** Recommend park unless P29 + P30 underperform target.

**Definition of done.**
- File-read tokens ↓ ≥25%.
- Review re-run cost ↓ ≥20%.
- (If P31 ships) Sub-question call count ↓ ≥40%, FP rate <3%.

**Risks specific to this phase.**
- **Staleness.** A cache that returns stale results silently degrades quality. Aggressive invalidation (hash check, mtime check, version check) on every read.
- **P31 silent quality regression.** Semantic cache may return a wrong-match that the model treats as authoritative. The FP rate sample (N=100) is the safety net; require <3% before Keep.
- **`teardown` rollback complexity.** All three packages are `teardown` class. Decommission procedures in the rollout doc; verify on a staging environment before shipping.

---

# Phase I — Latency UX

**Outcome.** Spec/Design narrative output streams to the user; perceived TTFT drops materially.

**Packages.** P32 (streaming for user-facing phases).

**Component touchpoints.**
- API call construction — enable `stream: true` on user-facing-phase requests.
- Output handler — assemble streamed chunks into the final artifact; handle stream-end markers; surface partial content to the user UI.
- Non-user phases — explicitly opt out of streaming (no benefit).

**Sequence of work.**
1. Flag user-facing-phase API calls as streaming.
2. Build / extend the stream-handler to assemble chunks and surface them.
3. Ship; measure TTFT drop on Spec/Design.

**Key implementer decisions.**
- UI surface for streamed output. If Loom is a CLI / agent harness, the existing terminal stream may already work. If a web UI, server-sent events or websockets.

**Definition of done.**
- TTFT on Spec/Design drops measurably; total token cost unchanged.
- Stream-end marker handling correct; no truncation; no partial-JSON parse failures.

**Risks specific to this phase.**
- **Stream-end markers.** Most streaming bugs are in the boundary handling — final-chunk detection, content-length sentinel, partial-JSON parse. Test explicitly with truncated streams (kill the connection mid-stream and verify recovery).

---

# Park — Experimental tier (Z1–Z9)

**Recommendation: defer the entire Park section.** Revisit only after P1–P32 is shipped and evaluated. The wave is designed to land cost/latency targets without these.

If the wave underdelivers, the most likely candidates to promote out of Park (in order):

1. **Z3 (trained compactor)** — if P24/P25's prompt-engineered compactor shows quality gaps that a trained one would fix.
2. **Z8 (request hedging)** — if tail latency is a measured pain point and P32 streaming isn't enough.
3. **Z6 (MoA for hard Review)** — if P23 cascade still leaves a Review-cost gap on architectural cases.
4. **Z1 (MemGPT)** or **Z2 (Cosmos)** — if context-budget pressure remains on long-running projects. These are mutually exclusive; pick one.
5. **Z4 / Z5 (speculative tools / actions)** — if latency is the bottleneck rather than cost. Reversibility complexity is the risk.
6. **Z7 (RouteLLM)** — only if rule-based routing in D-phase shows blind spots.
7. **Z9 (KV-cache sticky routing)** — only if Loom moves to self-hosted inference.

Implementation plans for Park items are **not written** until promotion. Each would be a new mini-phase with its own document.

---

# Cross-cutting concerns

A few items that span phases and need a one-time decision:

**Versioning / branching strategy.** Each package on its own branch (`opt/p_n_<name>`); each Keep is a merge to main; rollback is revert-merge. Drop packages are abandoned branches.

**Eval-harness seed control.** Most cost variance comes from model nondeterminism. If Anthropic's API supports request seeds (currently does not for the message API but may at some point), pin them. Otherwise, accept σ from D4 as the baseline noise.

**Cache-warming between packages.** Always Warm mode unless the package explicitly demands Cold or Steady-state. After every Keep, run a single Warm-priming eval to refresh the cache before the next package's measurement begins.

**Documentation discipline.** Each Keep updates the running decision matrix (in the rollout doc) and any affected SKILL prompts. Don't leave "we made this change" in chat-only.

**Telemetry persistence.** D1–D7 dashboards must persist data across the wave (not rolling 24h) — you'll want to compare P32's end-state metrics against P0 baseline directly.

---

# Open questions to resolve before P1 ships

(Restated from the executive summary, in the form they need answers.)

1. Which dashboard backend for D1–D8? **[your call]**
2. Where do `baseline-variance.json` and `baseline-review-findings.json` live? **[your call]**
3. Which baseline project for the eval harness? **[your call]**
4. Multi-provider strategy — is the wave Anthropic-only? **[your call]**
5. Audit-first or ship-first sequence? **[recommend audit-first]**
6. Park semantic cache (P31) by default, or pilot? **[recommend park]**
7. Park LLMLingua-2 (P27) if no >10K-token doc-ingesting subagents exist? **[your call after audit]**
8. Phase-boundary streaming target — if Loom is a CLI, P32 may be trivial. **[your call]**

Once these eight are answered, P1 has everything it needs.
