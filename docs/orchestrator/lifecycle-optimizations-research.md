# Loom — Performance Optimization Research

**Purpose.** Catalogue of additional techniques to drastically reduce token cost, latency, and wasted caching for the Loom orchestration framework — going *beyond* what Loom already does (5-phase pipeline, fresh-context subagents, kanban shared state, typed RETURN schemas, capability minimization, /tune).

**Status.** Temporary research file. Sources cited inline by short code; full URL list at the bottom.

---

## Reading the tags

Every technique carries **four** tags so you can filter quickly.

### Cost (implementation effort for Loom)
- **Low** — config flag, lint rule, single SKILL edit, single-file change
- **Medium** — new subagent, new helper service, schema redesign, mid-sized refactor
- **High** — new subsystem (memory store, trained model, sandboxed executor), multi-week build

### Improvement (cited size of the win)
- **Low** — <15% on the relevant axis (tokens, latency, accuracy)
- **Medium** — 15–50%
- **High** — >50%, or "step-change" architectural win
- **Indirect** — doesn't save tokens itself but is a prerequisite for other wins

### Maturity (how reliable the evidence is)
- **F = Foundational** — common knowledge, widely deployed, vendor-documented, "everyone agrees"
- **D = Documented** — several independent production write-ups or solid published benchmarks; works, but each shop reports slightly different numbers
- **E = Experimental** — research-paper-stage or a single shop's blog; promising but not yet broadly verified, may not survive the trip to production

### Layer (which part of Loom changes)
- **P = Prompt / terminology** — the change lives in the wording inside SKILL prompts, schemas, or return-shape contracts. No new agent, no new pipe, no new tool.
- **C = Connection / composition** — the change lives in how phases, subagents, or tools are *wired together*: routing rules, dispatch patterns, retry composition, what flows where. Loom-shape changes.
- **I = Infrastructure / concept-agnostic** — pure plumbing, model-agnostic, framework-level: caching, batching, telemetry, memoization, hashing, transport. Would apply to any orchestrator, not just Loom.

### Sort order

Categories are ordered top-to-bottom from **best return-on-effort** (cheapest to ship, biggest win) down to **expensive heavy-lifts**. Within each category, individual techniques are tagged with all four codes.

---

## TL;DR — the seven cheapest wins worth doing this week

If you do nothing else, these seven are Low-cost / High-improvement and should ship before any of the larger items. **All seven are Foundational maturity** (F) — no experimental risk:

1. **Lock the cache prefix byte-for-byte.** (F, I) Sort tool JSON keys, freeze tool order, kill timestamps in the system prompt. GitHub Copilot's 93% cache-hit rate is achievable. [PCC, GHTE]
2. **1-hour cache TTL on the static SKILL+tools prefix.** (F, I) Pays for itself after 3 reads vs 5-min TTL after 2. [APC]
3. **Audit subagent caching.** (D, I) Anthropic Agent SDK ships with `enablePromptCaching: false` for subagents; Claude Code's Task tool omits cache_control on a ~3.5K env block. Verify once. [GH-50213, GH-29966]
4. **Batch API for non-interactive phases.** (F, I) 50% off input *and* output, stacks with caching → ~95% off list on cached batches. [APR]
5. **Haiku for the coordinator and board mutations.** (F, C) Three-tier routing cited at 50-80% cost reduction in production. [AMR]
6. **Tighten `max_tokens` per subagent.** (F, I) Classifier = 5, kanban mutator = 200, narrative only when needed. [SMT]
7. **Add a cache-hit-rate dashboard.** (F, I) You cannot fix what you cannot see; ProjectDiscovery hit 59% cost cut once they could measure. [PD]

The rest of this file expands every category, with each technique tagged.

---

## Tier 1 — Low cost, high improvement (ship first)

### 1. Prompt-caching mastery

Loom's biggest hidden tax is almost certainly silent cache misses. Every byte change above a cache breakpoint invalidates everything below it.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Plain-English description | Source |
|---|---|---|---|---|---|---|---|
| 1.1 | Stable-prefix hierarchy (tools → system → messages) | Low | High | F | I | Sort tool JSON keys, freeze tool order, never interpolate dates/UUIDs into the cached system prompt. Byte-for-byte lookup; capitalising two letters in a 2.7K-token prompt cited as destroying the entire cache. | PCC, PCM |
| 1.2 | 1-hour TTL on truly-static prefixes | Low | Med-High | F | I | Cache write is 1.25× base for 5-min TTL, 2× for 1-hour; reads 0.1× either way. 1-hour breaks even after 3 reads. Apply only on the static SKILL/system+tools prefix; longer TTL must appear *earlier* in the request. | APC, AIC |
| 1.3 | Four-breakpoint layering | Low | Medium | F | I | Up to 4 `cache_control` breakpoints per request, free. Place at boundaries with different change frequencies: tools (1h), system+skills (1h), phase context (5m), task context (5m). | APC, PH |
| 1.4 | 20-block lookback safety breakpoint | Low | Low-Med | D | I | Anthropic's cache lookup scans only the last 20 content blocks. Long agent transcripts can outrun it. Add a second breakpoint near the live tail. | APC |
| 1.5 | Subagent cache-bug audit | Low–Med | Medium | D | I | Anthropic Agent SDK ships `enablePromptCaching: false` on subagent spawns; Claude Code's Task tool omits `cache_control` on a ~3.5K env block, so every fresh subagent re-writes ~4.7K tokens. If Loom wraps Anthropic SDK, force-on and add explicit breakpoints. | GH-50213, GH-29966, GH-44724 |
| 1.6 | Cache pre-warming on phase boundary | Low | Low / Med TTFT | D | I | Fire a `max_tokens=1` request at phase transition so the next phase's static prefix is hot for the first real call. | APC |
| 1.7 | "System-reminder" tail pattern for dynamic data | Low | Medium | F | P | Dates, IDs, timestamps go into a non-cached *tail* block of the user turn — not into the cached system prompt. Exactly what Claude Code itself does internally. | PCM, CCC |
| 1.8 | No mid-session model switching | Low (policy) | Low-Med | F | C | Caches are per-model. Switching Sonnet→Opus mid-task throws away every cached prefix on that thread. Commit per phase. | CCC |

### 2. Output-token reduction

Output tokens cost roughly 3-10× input tokens at the same model tier. Tightening them is the single most underused lever.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 2.1 | Aggressive per-subagent `max_tokens` | Low | Medium | F | I | Per-subagent caps: classifier = 5, kanban mutator = 200, narrative only as needed. Cited 90% saving on a headline generator capped at 50 vs default 1000. | SMT, RDS |
| 2.2 | Return-by-reference (cite IDs, not content) | Low | Medium | F | P | Subagents return `{decision: "approve", evidence: ["US-014", "T-031"]}`, not pasted artifact text. Coordinator dereferences if needed. Natural extension of Loom's typed RETURN schemas. | (Loom-native) |
| 2.3 | "Be concise" system-prompt tax | Low | Low-Med | F | P | Explicit "no preamble, no filler, ≤N words, data only" in every SKILL prompt. Pairs with `max_tokens`. Typical 10-30% per output. | RDS |
| 2.4 | Constrained / structured JSON decoding | Low | Low-Med | F | I | JSON-schema-constrained output stops at close-brace, no filler. Wins are mostly reliability + downstream parse-retries avoided. *Caveat*: don't apply to free-form narrative. | OSO, AC |

### 3. Observability for cost (enables every other lever)

You cannot optimise what you cannot attribute. Indirect — doesn't save tokens itself, but every other category needs the dashboard to be worth shipping.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 3.1 | Cache-hit-rate KPI per subagent | Low | Indirect (large) | F | I | Track `cache_read / (cache_read + cache_write + input)` per subagent. Below 60%? Something upstream is mutating. GitHub Copilot ships 93% as a target; ProjectDiscovery hit -59% cost once they could see it. | PD, GHTE, SD |
| 3.2 | Per-phase / per-subagent token attribution | Low | Indirect (20-50% follow-on) | F | I | Tag every API call with phase + subagent + task-ID. Anthropic: 80% of multi-agent performance variance is explained by token usage alone. | AMR, TT, LF |
| 3.3 | Cost-distribution healthcheck | Low | Indirect | D | I | Augment's ratio: planning/coordinator ≈ 9.8% of total tokens, workers ≈ 70.6%. Coordinator exceeding that is accumulating context it shouldn't. Set as alarm. | ATC |
| 3.4 | OpenTelemetry GenAI semantic conventions | Medium (one-time) | Indirect | F | I | Standard span attrs (`gen_ai.system`, `gen_ai.usage.input_tokens`) so Loom's traces work with Datadog / Honeycomb / Arize / Langfuse without bespoke adapters. | NXS, GC |

### 4. Cheap routing & gating

Zero-LLM or cheap-LLM filters that prevent the expensive model from being called at all.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 4.1 | Three-tier Haiku/Sonnet/Opus routing | Medium | High (50-80%) | F | C | Haiku for classification, routing, board mutations, lint. Sonnet for Spec/Design/Build. Opus only for hard reasoning. Typical 60/30/10 distribution. | AMR, AMR-Guide, MLM |
| 4.2 | Deterministic pre-agent shell prefetch | Low | High (19-62%) | D | C | Run `gh`, `git diff`, `ls`, lint *before* the agent loop starts. GitHub Copilot cited 8-12 KB context shaved per run, 19-62% overall efficiency gain. | GHTE |
| 4.3 | Deterministic relevance gate (skip-LLM filter) | Low | High (-43%) | D | C | GitHub's "Security Guard" achieves -43% by skipping the LLM entirely on PRs that don't touch security-sensitive paths. Loom analogue: cheap rule-based gates on Review tasks. | GHTE |
| 4.4 | Tool-search tool (deferred tool loading) | Low | High (85% on tool tokens) | D | I | Anthropic's built-in `tool_search` exposes only the 3-5 tools the model actually needs from a large catalogue. Cited 191K preserved vs 122K baseline. | TS, ACE |
| 4.5 | Selective extended thinking | Low | Medium | F | P | Thinking tokens bill at output rates; 4K-thinking + 500-output ≈ 9× a bare answer. Turn `budget_tokens` on only for designated hard gates. Start at the 1,024-token minimum. | AET, DD |

### 5. Batch & async dispatch

Stacks multiplicatively with caching: batch is 50% off, cache hits are 0.1× — combined ≤5% of list price on cached batches.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 5.1 | Batch API for non-interactive phases | Low-Med | High (50% + stacks with cache) | F | I | Anthropic Message Batches: 50% off input and output, results within 24h (most <1h). Use for nightly Review sweeps, eval runs, batch refactors, "all T-NNN at once" Build phases. | APR, JAB |
| 5.2 | Parallel subagent fan-out | Low (already isolated) | High (latency) | F | C | Independent subtasks fan out concurrently. Anthropic's own research system cites up to 90% research-time reduction from parallel subagents. Just lift any serial constraint. | AMR |

---

## Tier 2 — Medium cost, high improvement

### 6. Context compression

For phases that ingest large reference docs (specs, ADRs, code snapshots), compression is the second-biggest lever after cache discipline.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 6.1 | Progressive disclosure / pass-by-ID | Low | High (98.7% cited) | D | C | Don't dump full `spec.md` into a subagent — pass IDs (US-007, Q-014) plus a `read_artifact(id)` tool. Anthropic's MCP code-execution post cites 150K → 2K tokens. Loom's stable IDs make this trivial. | ACE |
| 6.2 | LLMLingua-2 prompt compression | Medium | Med-High (2-5× typical, up to 20×) | D | I | Microsoft's small BERT-class encoder labels tokens keep/drop. 2-5× compression with negligible quality loss; 1.6-2.9× lower end-to-end latency. Drop in front of any subagent that reads large reference docs. | LL, MS, LLL |
| 6.3 | Structured handoff schema | Medium | Med tokens + High continuity | D | P/C | Replace blob-summary compaction with typed schema: `{intent, changes_made, decisions, next_steps, open_questions}`. Sourcegraph Amp killed compaction entirely for this. Factory's eval shows it beats built-ins. | FAC, AMP |
| 6.4 | AST-based code context selection | Medium | Medium | D | I | Retrieve code via tree-sitter AST + call/import graph rather than embedding chunks. Windsurf and Cursor prefer grep+AST over vector RAG at scale. | A7T, MIS |
| 6.5 | Active context trimming | Medium | Med tokens + High accuracy | D | C | Chroma's 18-model study: every frontier model degrades well before its context limit; quality follows a U-curve, middle drops 30%+. Augment measured 22.7% token saving with scheduled compression vs 6% passive. | CR, ML, ATC |
| 6.6 | Code-execution-as-tool (MCP "skill" pattern) | Medium | High (98.7% extreme) | D | C | Instead of N tool calls each producing model-visible JSON, generate one script that calls N tools and only emits the final slice. Anthropic example: 10K-row sheet → 5 rows. | ACE |

### 7. Smarter retries

Loom's 3-attempt cap is correct; what happens *inside* each retry is where most pipelines waste cycles.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 7.1 | Reflexion before retry, not after | Low-Med | High (success rate) | D | P | Carry forward a `previous_attempt_failure_summary` block into attempt N+1, not the raw transcript. NeurIPS 2023: 10-20 pp gain on coding benchmarks vs naive retry. | RX, PGR |
| 7.2 | Partial-state preservation across retries | Medium | Medium | D | C | On retry, keep the parts of the kanban / artifacts that succeeded; only re-run the failed step. Augment notes that full re-planning re-pays the planner cost. | ATC |
| 7.3 | Different prompt per retry attempt | Low | Medium | D | P | Don't retry with identical input. Retry-2 adds reflection; retry-3 escalates model tier (Sonnet → Opus). | (Reflexion + FrugalGPT) |

### 8. Tool-result caching

Deterministic side-effect-free tools should never run twice with the same input.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 8.1 | Content-addressed file-read cache | Medium | Medium (~26-36%) | D | I | Hash every file on read; if hash unchanged, return "no change"; if changed, return diff only. Cited 36% token reduction (33-35K saved) across three tasks. | CB |
| 8.2 | Web-fetch / test-result memoization | Medium | Medium | D | I | Same idea, keyed on URL+ETag, command+input-hash, commit SHA. Especially valuable in Review where the same test suite reruns across attempts. | (Same pattern) |
| 8.3 | Semantic cache for sub-question reuse | Medium | Med-High (~60-68%) | D | I | Agents re-phrase the same sub-question across runs. GPT Semantic Cache: 61-68% API call reduction with >97% positive hit rate. Drop Redis+embeddings in front of read-mostly subagents. | GSC, TF, PIS |

### 9. FrugalGPT-style escalation

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 9.1 | FrugalGPT cascade with confidence gating | Medium | High (up to 98% benchmark; 50-70% real) | D | C | Try Haiku first; if its self-eval / confidence is below threshold, escalate to Sonnet, then Opus. Useful on Review (cheap-first lint, expensive-only-on-flag). | FRG, PFG |

### 10. Latency tricks

Mostly perceived-latency wins.

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 10.1 | Streaming for TTFT | Low | High perceived (no token cost change) | F | I | TTFT under 600ms p95 "feels great". Stream user-facing phase output; non-user phases stay non-streamed. | TP, QC |
| 10.2 | Request hedging (Google "tail at scale") | Medium | High tail latency, Low overhead (~9%) | D | I | Fire a backup request when primary exceeds p90 TTFT; cap hedge rate with a token bucket. Cited p99 cut 64ms → 17ms (74%). | HD |

---

## Tier 3 — Medium cost, medium improvement

### 11. Provider-native features (don't reinvent)

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 11.1 | Gemini implicit + explicit caching | Low (awareness) | Medium when targeted | F | I | Gemini 2.5+ has implicit caching (auto 75-90% discount) and explicit (guaranteed 90%). If Loom multi-provider routes, lean on it. | GEM, GDG |
| 11.2 | GPT-5 built-in router | Low | Medium | F | I | OpenAI ships a real-time router (fast vs thinking) inside the API. Don't reimplement what's free. | OAI |
| 11.3 | Anthropic native tool_search & code execution | Low | High on tool-heavy subagents | D | I | Built-in; turn on rather than build custom MCP equivalents. | TS, ACE |

---

## Tier 4 — High cost, high improvement (justified only at scale)

### 12. Memory subsystems

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 12.1 | MemGPT-style hierarchical memory | High | Med-High long-running | E | C | Two-tier (in-context "core" + external "archival/recall") with the model deciding what to page in. Maps onto Loom: kanban = core, `.pipeline` history + spec = archival. | MGP, LT, AM |
| 12.2 | Cosmos-style shared persistent memory | High | High (53.7% cited) | E | C | Org-level "shared context window" replaces redundant re-encoding across agent calls. Augment cites 53.7% token reduction. Loom analogue: project-level append-only "team brain". | CSM |
| 12.3 | Trained / dedicated compactor subagent | High | Med-High | E | C | Don't trust the model's own self-summary. A separate compactor with explicit must-preserve fields (paths, errors, endpoints, rejected approaches) avoids the "game of telephone" cliff. | CGN |

### 13. Speculative execution

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 13.1 | PASTE — pattern-aware speculative tool execution | High | High (48.5% latency) | E | I | Exploits recurring tool-call patterns to speculatively execute the next tool while the LLM is still thinking. 48.5% avg task-completion time reduction. | PST |
| 13.2 | Speculative actions (tool prefetch) | High | Medium (~20% latency) | E | I | A fast model predicts the next likely tool call and executes it in parallel. Up to 55% next-action accuracy → up to 20% latency cut. | SA, AW |
| 13.3 | Speculative decoding (self-host only) | Low (config) | Med-High (2-3× speedup) | D | I | Provider-controlled on hosted Anthropic. On self-hosted vLLM, enable prefix caching + spec decoding for 2-3× speedup, 3.6× throughput on H200. | BML, ITL |

### 14. KV-cache aware routing (self-host only)

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 14.1 | Sticky session routing on prefix hash | Med-High | Medium (~22%) | D | I | Route same-prefix requests to the same serving node via consistent prefix-hash. Red Hat llm-d / Clarifai 12.3 cite 22.3% throughput vs round-robin. N/A if Loom only uses hosted Anthropic. | RHD, CLF, RN |

### 15. Ensembles for hard cases

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 15.1 | Mixture-of-Agents for hard Review only | High | Quality up, cost down vs single frontier on hard tasks | E | C | Layered open-model ensemble (MoA-Lite: 2 layers, proposers + Qwen aggregator) beats GPT-4 Turbo by ~4% on AlpacaEval at half the cost. Selective Review-only use. | MoA, TM |
| 15.2 | RouteLLM learned router | High (training) | Medium (~2×) | E | C | Trained router decides per-query which model to call. 2× cost reduction at 95% of GPT-4 quality on MT-Bench. | RLM |

---

## Tier 5 — Discipline / architectural cautions (zero cost)

### 16. Things to *not* do

| # | Technique | Cost | Improvement | Mat. | Lyr. | Description | Source |
|---|---|---|---|---|---|---|---|
| 16.1 | "Stop building multi-agent" counter-lesson | Free | Avoids future bloat | D | C | Cognition's public argument: fewer agents, better context engineering inside one — handoff is lossy. Loom's 5 phases are right-sized; don't grow to 7 to enforce one rule. | CGN-MA, JX |
| 16.2 | Coordinator never reads worker transcripts | Free | High (53.7% cited) | F | C | Augment's 53.7% reduction came from preventing a coordinator from accumulating workflow history. Coordinator sees **only** typed RETURN values. | ATC |
| 16.3 | No mid-session model switching | Free | Medium | F | C | (Duplicate of 1.8, emphasised.) Caches are per-model; switching tier mid-task throws away the cache. | CCC |
| 16.4 | Provider-native first; build custom only when forced | Free | Avoids re-implementing free features | F | I | Gemini implicit caching, GPT-5 router, Anthropic `tool_search`, Anthropic batch API — all free. Custom replacements should clear a high bar. | GEM, OAI, TS, APR |

---

# Filter views

The same techniques sliced two different ways, so you can pick whichever filter you're thinking in.

## A. By maturity (ship-now vs research-stage)

### A1. Foundational — F (ship without controversy)

Common knowledge, vendor-documented or widely deployed. Risk is low; pushback is unlikely. **Do these first.**

| # | Technique | Cost | Impr. | Layer |
|---|---|---|---|---|
| 1.1 | Stable-prefix hierarchy | Low | High | I |
| 1.2 | 1-hour TTL on static prefixes | Low | Med-High | I |
| 1.3 | Four-breakpoint layering | Low | Medium | I |
| 1.7 | "System-reminder" tail pattern | Low | Medium | P |
| 1.8 | No mid-session model switching | Low | Low-Med | C |
| 2.1 | Aggressive per-subagent `max_tokens` | Low | Medium | I |
| 2.2 | Return-by-reference | Low | Medium | P |
| 2.3 | "Be concise" prompt tax | Low | Low-Med | P |
| 2.4 | Constrained JSON decoding | Low | Low-Med | I |
| 3.1 | Cache-hit-rate KPI | Low | Indirect | I |
| 3.2 | Per-phase token attribution | Low | Indirect | I |
| 3.4 | OpenTelemetry GenAI conventions | Med | Indirect | I |
| 4.1 | Three-tier model routing | Med | High | C |
| 4.5 | Selective extended thinking | Low | Medium | P |
| 5.1 | Batch API | Low-Med | High | I |
| 5.2 | Parallel subagent fan-out | Low | High | C |
| 10.1 | Streaming for TTFT | Low | High perceived | I |
| 11.1 | Gemini implicit + explicit caching | Low | Medium | I |
| 11.2 | GPT-5 built-in router | Low | Medium | I |
| 16.2 | Coordinator never reads transcripts | Free | High | C |
| 16.3 | No mid-session switching (dup) | Free | Medium | C |
| 16.4 | Provider-native first | Free | (preventive) | I |

### A2. Documented — D (well-supported but each shop reports different numbers)

Several independent production write-ups or solid published benchmarks. **Reasonable bets**, but pilot first and instrument carefully.

| # | Technique | Cost | Impr. | Layer |
|---|---|---|---|---|
| 1.4 | 20-block lookback safety breakpoint | Low | Low-Med | I |
| 1.5 | Subagent cache-bug audit | Low-Med | Medium | I |
| 1.6 | Cache pre-warming on phase boundary | Low | Low / Med TTFT | I |
| 3.3 | Cost-distribution healthcheck | Low | Indirect | I |
| 4.2 | Deterministic pre-agent shell prefetch | Low | High | C |
| 4.3 | Deterministic skip-LLM gate | Low | High | C |
| 4.4 | Tool-search tool | Low | High | I |
| 6.1 | Progressive disclosure / pass-by-ID | Low | High | C |
| 6.2 | LLMLingua-2 prompt compression | Med | Med-High | I |
| 6.3 | Structured handoff schema | Med | Med + continuity | P/C |
| 6.4 | AST-based code context selection | Med | Medium | I |
| 6.5 | Active context trimming | Med | Med + accuracy | C |
| 6.6 | Code-execution-as-tool | Med | High | C |
| 7.1 | Reflexion before retry | Low-Med | High | P |
| 7.2 | Partial-state preservation across retries | Med | Medium | C |
| 7.3 | Different prompt per retry attempt | Low | Medium | P |
| 8.1 | Content-addressed file-read cache | Med | Medium | I |
| 8.2 | Web-fetch / test-result memoization | Med | Medium | I |
| 8.3 | Semantic cache for sub-questions | Med | Med-High | I |
| 9.1 | FrugalGPT cascade | Med | High | C |
| 10.2 | Request hedging | Med | High tail | I |
| 11.3 | Anthropic native tool_search + code exec | Low | High | I |
| 13.3 | Speculative decoding (self-host) | Low | Med-High | I |
| 14.1 | KV-cache sticky routing (self-host) | Med-High | Medium | I |
| 16.1 | "Stop building multi-agent" discipline | Free | Preventive | C |

### A3. Experimental — E (research-stage, treat as bets)

Research-paper or single-shop blog. **Promising but not yet broadly verified** — pilot on a single phase, instrument hard, treat unproven claims as ceilings not floors.

| # | Technique | Cost | Impr. | Layer |
|---|---|---|---|---|
| 12.1 | MemGPT-style hierarchical memory | High | Med-High | C |
| 12.2 | Cosmos-style shared persistent memory | High | High (claim) | C |
| 12.3 | Trained / dedicated compactor subagent | High | Med-High | C |
| 13.1 | PASTE speculative tools | High | High (48.5% claim) | I |
| 13.2 | Speculative actions / tool prefetch | High | Medium | I |
| 15.1 | Mixture-of-Agents for hard Review | High | Quality | C |
| 15.2 | RouteLLM trained router | High | Medium | C |

---

## B. By layer (where the change physically lives in Loom)

Same items, regrouped by *what you actually have to edit* to ship them.

### B1. Prompt / terminology layer — P

Lives inside SKILL prompts, return-shape schemas, or the wording of inputs. **No new agent, no new pipe, no new tool.** Cheapest to ship; safest to roll back.

| # | Technique | Cost | Impr. | Mat. |
|---|---|---|---|---|
| 1.7 | "System-reminder" tail pattern for dynamic data | Low | Medium | F |
| 2.2 | Return-by-reference (cite IDs, not content) | Low | Medium | F |
| 2.3 | "Be concise" system-prompt tax | Low | Low-Med | F |
| 4.5 | Selective extended thinking (per-prompt budget) | Low | Medium | F |
| 6.3 | Structured handoff schema *(shared with C)* | Med | Med + continuity | D |
| 7.1 | Reflexion before retry (failure-summary block) | Low-Med | High | D |
| 7.3 | Different prompt per retry attempt | Low | Medium | D |

### B2. Connection / composition layer — C

Lives in how phases, subagents, and tools are *wired together*. Touches routing rules, dispatch logic, retry composition, what flows where. **Loom-shape changes** — affects the orchestrator, not the model.

| # | Technique | Cost | Impr. | Mat. |
|---|---|---|---|---|
| 1.8 | No mid-session model switching | Low | Low-Med | F |
| 4.1 | Three-tier Haiku/Sonnet/Opus routing | Med | High | F |
| 4.2 | Deterministic pre-agent shell prefetch | Low | High | D |
| 4.3 | Deterministic skip-LLM relevance gate | Low | High | D |
| 5.2 | Parallel subagent fan-out | Low | High latency | F |
| 6.1 | Progressive disclosure / pass-by-ID | Low | High | D |
| 6.3 | Structured handoff schema *(shared with P)* | Med | Med + continuity | D |
| 6.5 | Active context trimming (schedule) | Med | Med + accuracy | D |
| 6.6 | Code-execution-as-tool (MCP skill pattern) | Med | High | D |
| 7.2 | Partial-state preservation across retries | Med | Medium | D |
| 9.1 | FrugalGPT cascade with confidence gating | Med | High | D |
| 12.1 | MemGPT hierarchical memory | High | Med-High | E |
| 12.2 | Cosmos-style shared persistent memory | High | High | E |
| 12.3 | Trained / dedicated compactor subagent | High | Med-High | E |
| 15.1 | Mixture-of-Agents for hard Review | High | Quality | E |
| 15.2 | RouteLLM trained router | High | Medium | E |
| 16.1 | "Stop building multi-agent" discipline | Free | Preventive | D |
| 16.2 | Coordinator never reads worker transcripts | Free | High | F |
| 16.3 | No mid-session model switching (dup of 1.8) | Free | Medium | F |

### B3. Infrastructure / concept-agnostic layer — I

Pure plumbing, model-agnostic. Caching, batching, telemetry, memoization, hashing, transport. **Would apply to any orchestrator**, not just Loom.

| # | Technique | Cost | Impr. | Mat. |
|---|---|---|---|---|
| 1.1 | Stable-prefix hierarchy | Low | High | F |
| 1.2 | 1-hour TTL on static prefixes | Low | Med-High | F |
| 1.3 | Four-breakpoint layering | Low | Medium | F |
| 1.4 | 20-block lookback safety breakpoint | Low | Low-Med | D |
| 1.5 | Subagent cache-bug audit | Low-Med | Medium | D |
| 1.6 | Cache pre-warming on phase boundary | Low | Low / Med TTFT | D |
| 2.1 | Aggressive per-subagent `max_tokens` | Low | Medium | F |
| 2.4 | Constrained JSON decoding | Low | Low-Med | F |
| 3.1 | Cache-hit-rate KPI | Low | Indirect | F |
| 3.2 | Per-phase token attribution | Low | Indirect | F |
| 3.3 | Cost-distribution healthcheck ratio | Low | Indirect | D |
| 3.4 | OpenTelemetry GenAI semantic conventions | Med | Indirect | F |
| 4.4 | Tool-search tool (deferred tool loading) | Low | High on tool tokens | D |
| 5.1 | Batch API for non-interactive phases | Low-Med | High | F |
| 6.2 | LLMLingua-2 prompt compression | Med | Med-High | D |
| 6.4 | AST-based code context selection | Med | Medium | D |
| 8.1 | Content-addressed file-read cache | Med | Medium | D |
| 8.2 | Web-fetch / test-result memoization | Med | Medium | D |
| 8.3 | Semantic cache for sub-question reuse | Med | Med-High | D |
| 10.1 | Streaming for TTFT | Low | High perceived | F |
| 10.2 | Request hedging | Med | High tail | D |
| 11.1 | Gemini implicit + explicit caching | Low | Medium | F |
| 11.2 | GPT-5 built-in router | Low | Medium | F |
| 11.3 | Anthropic native tool_search + code exec | Low | High | D |
| 13.1 | PASTE pattern-aware speculative tools | High | High | E |
| 13.2 | Speculative actions / tool prefetch | High | Medium | E |
| 13.3 | Speculative decoding (self-host) | Low | Med-High | D |
| 14.1 | KV-cache sticky session routing | Med-High | Medium | D |
| 16.4 | Provider-native first | Free | Preventive | F |

---

## Cross-cutting matrix — one-glance ranking

Best-to-worst ROI per individual technique (across all tiers), now with maturity + layer tags:

| Rank | Technique | Cost | Impr. | Mat. | Lyr. |
|---|---|---|---|---|---|
| 1 | Stable-prefix hierarchy (1.1) | Low | High | F | I |
| 2 | Coordinator never reads transcripts (16.2) | Free | High | F | C |
| 3 | Batch API (5.1) | Low-Med | High | F | I |
| 4 | Tool-search tool (4.4) | Low | High | D | I |
| 5 | Deterministic pre-agent prefetch (4.2) | Low | High | D | C |
| 6 | Skip-LLM relevance gate (4.3) | Low | High | D | C |
| 7 | Three-tier model routing (4.1) | Med | High | F | C |
| 8 | Progressive disclosure / pass-by-ID (6.1) | Low | High | D | C |
| 9 | Subagent cache-bug audit (1.5) | Low-Med | Medium | D | I |
| 10 | Return-by-reference (2.2) | Low | Medium | F | P |
| 11 | Per-subagent `max_tokens` (2.1) | Low | Medium | F | I |
| 12 | Cache-hit-rate KPI (3.1) | Low | Indirect-large | F | I |
| 13 | 1-hour TTL (1.2) | Low | Med-High | F | I |
| 14 | Reflexion before retry (7.1) | Low-Med | High | D | P |
| 15 | Parallel subagent fan-out (5.2) | Low | High latency | F | C |
| 16 | Code-execution-as-tool (6.6) | Med | High | D | C |
| 17 | LLMLingua-2 (6.2) | Med | Med-High | D | I |
| 18 | Active context trimming (6.5) | Med | Medium | D | C |
| 19 | Semantic cache (8.3) | Med | Med-High | D | I |
| 20 | FrugalGPT cascade (9.1) | Med | High | D | C |
| 21 | Content-addressed file cache (8.1) | Med | Medium | D | I |
| 22 | Structured handoff schema (6.3) | Med | Medium | D | P/C |
| 23 | Streaming TTFT (10.1) | Low | High perceived | F | I |
| 24 | Selective extended thinking (4.5) | Low | Medium | F | P |
| 25 | Cosmos-style shared memory (12.2) | High | High | **E** | C |
| 26 | PASTE speculative tools (13.1) | High | High latency | **E** | I |
| 27 | MemGPT memory (12.1) | High | Med-High | **E** | C |
| 28 | MoA for hard Review only (15.1) | High | Quality | **E** | C |
| 29 | RouteLLM (15.2) | High | Medium | **E** | C |
| 30 | KV-cache sticky routing (14.1) | Med-High | Medium | D | I |

**Reading the matrix.** Above rank 24, almost everything is **F** or **D** maturity — ship-now territory. Below rank 24, almost everything is **E** — experimental, bet selectively. The maturity cliff and the cost cliff land in roughly the same place, which is a good sanity check on the ranking.

---

## Loom-specific notes — where the existing concepts already pay

Several techniques above are **already partly implemented** in Loom by virtue of its existing concepts. The optimisation is mostly to **enforce more rigorously** rather than build anything new:

- **Return-by-reference (2.2)** — Loom's typed RETURN schemas already imply this. Audit that subagents are *actually* returning IDs and not pasted artifact text. **(P layer — just SKILL wording.)**
- **Coordinator never reads transcripts (16.2)** — Capability minimisation already removes Edit/Write from the coordinator. The remaining discipline is to also remove `Read` on worker transcript files; coordinator should *only* receive the typed RETURN payload. **(C layer.)**
- **Pass-by-ID (6.1)** — Stable cross-phase IDs (`Q-NNN/US-NNN/T-NNN`) are already the cross-reference vocabulary. The optimisation is to ensure subagents never inline the *content* of an artifact when an ID would suffice. **(C layer, with a P-layer SKILL nudge.)**
- **Skip-LLM gate (4.3)** — Loom's structural quality checks (`grep satisfies-stories: tasks/*`) are already deterministic gates. The optimisation is to add them more aggressively *before* Review subagent dispatch. **(C layer.)**
- **Parallel subagent fan-out (5.2)** — The DAG is already the parallelisation plan. The optimisation is to verify the dispatcher actually concurrent-fires on `blocked_by ⊆ done ∧ file_scope disjoint`, not serial-fires. **(C layer.)**
- **Batch API (5.1)** — Loom's `AFK` autonomy class is the perfect candidate for batch dispatch. Mark every `AFK` Build task as batch-eligible. **(I layer with a C-layer dispatcher tweak.)**

---

## Sources

Cited by short code above; alphabetical by code.

| Code | Title / Page |
|---|---|
| A7T | [Augment — 7 AI Agent Tactics for Multimodal, RAG-Driven Codebases](https://www.augmentcode.com/guides/7-ai-agent-tactics-for-multimodal-rag-driven-codebases) |
| AC | [Aidan Cooper — Guide to Structured Outputs Using Constrained Decoding](https://www.aidancooper.co.uk/constrained-decoding/) |
| ACE | [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) |
| AET | [Anthropic — Extended thinking docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) |
| AIC | [aicheckerhub — Anthropic Prompt Caching in 2026: Cost, TTL, and Latency Planning](https://aicheckerhub.com/anthropic-prompt-caching-2026-cost-latency-guide) |
| AM | [A-Mem — arXiv 2502.12110](https://arxiv.org/pdf/2502.12110) |
| AMP | [tessl.io — Amp drops compaction for 'handoff'](https://tessl.io/blog/amp-retires-compaction-for-a-cleaner-handoff-in-the-coding-agent-context-race/) |
| AMR | [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) |
| AMR-Guide | [Augment — Best AI Model for Coding Agents in 2026: A Routing Guide](https://www.augmentcode.com/guides/ai-model-routing-guide) |
| APC | [Anthropic — Prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| APR | [Anthropic — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| ATC | [Augment — AI Agent Loop Token Costs: How to Constrain Context](https://www.augmentcode.com/guides/ai-agent-loop-token-cost-context-constraints) |
| AW | [Agent Wiki — Speculative tool execution](https://agentwiki.org/speculative_tool_execution) |
| BML | [BentoML — Speculative decoding](https://bentoml.com/llm/inference-optimization/speculative-decoding) |
| CB | [cachebro — GitHub (content-addressed file cache for agents)](https://github.com/glommer/cachebro) |
| CCC | [Claude Code Camp — How Prompt Caching Actually Works in Claude Code](https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code) |
| CGN | [Cognition — Rebuilding Devin for Claude Sonnet 4.5](https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges) |
| CGN-MA | [Cognition — Multi-Agents: What's Actually Working](https://cognition.ai/blog/multi-agents-working) |
| CLF | [Clarifai 12.3 — KV Cache-Aware Routing](https://www.clarifai.com/blog/clarifai-12.3-introducing-kv-cache-aware-routing) |
| CR | [Chroma Research — Context Rot](https://www.trychroma.com/research/context-rot) |
| CSM | [Augment — Cosmos product page](https://www.augmentcode.com/product/cosmos) |
| DD | [Developers Digest — Extended thinking guide](https://developersdigest.tech/) |
| FAC | [Factory.ai — Evaluating Context Compression for AI Agents](https://factory.ai/news/evaluating-compression) |
| FRG | [FrugalGPT — arXiv 2305.05176](https://arxiv.org/abs/2305.05176) |
| GC | [groundcover — Agent observability](https://www.groundcover.com/) |
| GDG | [Google Developers — Gemini 2.5 implicit caching](https://developers.googleblog.com/gemini-2-5-models-now-support-implicit-caching/) |
| GEM | [Google — Gemini context caching docs](https://ai.google.dev/gemini-api/docs/caching) |
| GH-29966 | [GitHub issue — Agent SDK subagents have enablePromptCaching:false (#29966)](https://github.com/anthropics/claude-code/issues/29966) |
| GH-44724 | [GitHub issue — Subagent cache miss on first SendMessage resume (#44724)](https://github.com/anthropics/claude-code/issues/44724) |
| GH-50213 | [GitHub issue — Subagent requests don't place cache_control (#50213)](https://github.com/anthropics/claude-code/issues/50213) |
| GHTE | [GitHub Blog — Improving token efficiency in GitHub Agentic Workflows](https://github.blog/ai-and-ml/github-copilot/improving-token-efficiency-in-github-agentic-workflows/) |
| GSC | [GPT Semantic Cache — arXiv 2411.05276](https://arxiv.org/html/2411.05276v3) |
| HD | [GitHub — bhope/hedge (adaptive hedged requests)](https://github.com/bhope/hedge) |
| ITL | [Introl — Speculative Decoding: 2-3x LLM Inference Speedup](https://introl.com/blog/speculative-decoding-llm-inference-speedup-guide-2025) |
| JAB | [jangwook.net — Anthropic Message Batches API production guide](https://jangwook.net/en/blog/en/anthropic-message-batches-api-production-guide/) |
| JX | [Jason Liu — Why Cognition does not use multi-agent systems](https://jxnl.co/writing/2025/09/11/why-cognition-does-not-use-multi-agent-systems/) |
| LF | [Langfuse — Token & Cost Tracking docs](https://langfuse.com/docs/observability/features/token-and-cost-tracking) |
| LL | [microsoft/LLMLingua — GitHub](https://github.com/microsoft/LLMLingua) |
| LLL | [LongLLMLingua — arXiv 2310.06839](https://arxiv.org/html/2310.06839v2) |
| LT | [Letta — Agent Memory: How to Build Agents that Learn and Remember](https://www.letta.com/blog/agent-memory) |
| MGP | [MemGPT — arXiv 2310.08560](https://arxiv.org/abs/2310.08560) |
| MIS | [MindStudio — Why Cursor, Claude Code, and Devin Use grep, Not Vectors](https://www.mindstudio.ai/blog/is-rag-dead-what-ai-agents-use-instead) |
| ML | [Morph — Context Rot: Why LLMs Degrade as Context Grows](https://www.morphllm.com/context-rot) |
| MLM | [Morph — Sonnet vs Haiku](https://www.morphllm.com/) |
| MoA | [Mixture-of-Agents — arXiv 2406.04692](https://arxiv.org/abs/2406.04692) |
| MS | [Microsoft Research — LLMLingua blog](https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/) |
| NXS | [NexaStack — Open Telemetry & AI Agents](https://www.nexastack.ai/blog/open-telemetry-ai-agents) |
| OAI | [OpenAI — Introducing GPT-5 for developers](https://openai.com/index/introducing-gpt-5-for-developers/) |
| OSO | [OpenAI — Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| PCC | [Anthropic — Lessons from building Claude Code: Prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) |
| PCM | [mager.co — Claude: How prompt caching actually works](https://www.mager.co/blog/2026-04-29-claude-prompt-caching/) |
| PD | [ProjectDiscovery — How We Cut LLM Costs by 59% With Prompt Caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching) |
| PFG | [Portkey — Implementing FrugalGPT](https://portkey.ai/blog/implementing-frugalgpt-smarter-llm-usage-for-lower-costs/) |
| PGR | [PromptingGuide — Reflexion technique](https://www.promptingguide.ai/techniques/reflexion) |
| PH | [PromptHub — Prompt Caching with OpenAI, Anthropic, and Google Models](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models) |
| PIS | [PyImageSearch — Semantic Caching for LLMs](https://pyimagesearch.com/2026/04/27/semantic-caching-for-llms-fastapi-redis-and-embeddings/) |
| PST | [PASTE / Act While Thinking — arXiv 2603.18897](https://arxiv.org/abs/2603.18897) |
| QC | [QuarkAndCode — LLM Streaming Latency](https://medium.com/@QuarkAndCode/llm-streaming-latency-cut-ttft-smooth-tokens-fix-cold-starts-f2be60d26b89) |
| RDS | [Redis — LLM Token Optimization](https://redis.io/blog/llm-token-optimization-speed-up-apps/) |
| RHD | [Red Hat — Master KV cache aware routing with llm-d](https://developers.redhat.com/articles/2025/10/07/master-kv-cache-aware-routing-llm-d-efficient-ai-inference) |
| RLM | [RouteLLM — arXiv (LMSYS)](https://arxiv.org/abs/2406.18665) |
| RN | [Ranvier — KV Cache Locality: The Hidden Variable in Your LLM Serving Cost](https://ranvier.systems/2026/04/30/kv-cache-locality-the-hidden-variable-in-your-llm-serving-cost.html) |
| RX | [Reflexion — arXiv 2303.11366](https://arxiv.org/abs/2303.11366) |
| SA | [Speculative Actions — arXiv 2510.04371](https://arxiv.org/abs/2510.04371) |
| SD | [Start Debugging — How to Add Prompt Caching to an Anthropic SDK App and Measure the Hit Rate](https://startdebugging.net/2026/04/how-to-add-prompt-caching-to-an-anthropic-sdk-app-and-measure-the-hit-rate/) |
| SMT | [Statsig — Max tokens: Output length optimization](https://www.statsig.com/perspectives/sure-please-provide-the-title-or-main-topic-of-the-blog) |
| TF | [TrueFoundry — Semantic Caching](https://www.truefoundry.com/blog/semantic-caching) |
| TM | [Together AI — Together MoA blog](https://www.together.ai/blog/together-moa) |
| TP | [TianPan — TTFT Is the Only Latency Metric Your Users Actually Feel](https://tianpan.co/blog/2026-04-16-streaming-ttft-latency-perception) |
| TS | [Anthropic — Tool search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| TT | [TokenTelemetry — open-source local dashboard](https://tokentelemetry.com/) |
