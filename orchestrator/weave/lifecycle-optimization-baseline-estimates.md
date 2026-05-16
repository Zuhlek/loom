# Loom — Baseline Cost & Expected Per-Phase Impact

**Purpose.** Best-effort estimates of how each optimization phase (A–I from `lifecycle-optimization-rollout.md`) will move the six metrics the evaluation harness measures. Calibrated against the three filed baseline runs of the Bookmarks-baseline project in `orchestrator/evaluation/analytics/baseline/`.

**Read this first — the most important framing point.** The harness measures **token counts and wall-clock**, not dollars. Several optimization phases (notably D's model-tier routing and F's Batch API) reduce *price-per-token* without reducing token *count*. They will therefore look like zero-impact in the harness even when they save real money. This doc separates "moves harness metrics" from "saves dollars only" explicitly.

---

## The harness — what it measures

Six metrics, per Loom-lifecycle-phase (spec / design / plan / build / review), per weave run. Schema from `orchestrator/evaluation/analyze.py`:

| Metric | Source field | Unit |
|---|---|---|
| `wall_ms` | `duration_wall_ms` | milliseconds |
| `autonomous_ms` | `duration_autonomous_ms` | milliseconds |
| `input_tokens` | `tokens.input_tokens` | tokens (non-cached input) |
| `output_tokens` | `tokens.output_tokens` | tokens |
| `cache_creation` | `tokens.cache_creation_input_tokens` | tokens written to cache |
| `cache_read` | `tokens.cache_read_input_tokens` | tokens read from cache |

Aggregated per run as: sum of metric across all subagent invocations of each phase.

**What the harness does NOT measure:**
- **Dollar cost.** Anthropic prices change; the team multiplies later in a spreadsheet.
- **Orchestrator-side inference** outside the dispatched subagents (Spec's inline answer-queue consumption is invisible).
- **Per-task attribution inside Build.** The Build coordinator inline-implements tasks, so one big Build row replaces what should be many small T-NNN rows.
- **Spread / confidence intervals.** Means only. A single tail-latency run can move a phase mean noticeably.
- **TTFT.** Wall-clock total is captured; first-byte latency is not. Phase I (streaming) is invisible to the harness.

---

## Baseline numbers — what we're starting from

Three filed baseline runs. Run 3 (1778919632) is incomplete (no review row); excluded from means. Means below are across **run-1 (1778870535)** and **run-2 (1778916127)**.

### Per-phase mean (across two complete runs)

| Phase | Wall ms | Autonomous ms | Input | Output | cache_create | cache_read |
|---|---:|---:|---:|---:|---:|---:|
| spec | 165,045 | 186,767 | 56 | 8,707 | 211,262 | 844,279 |
| design | 174,030 | 183,915 | 25 | 11,583 | 44,544 | 351,632 |
| plan | 307,901 | 325,020 | 53 | 22,581 | 113,603 | 1,134,629 |
| build | 940,377 | 827,628 | 189 | 53,280 | 457,501 | 13,821,119 |
| review | 303,696 | 347,150 | 100 | 18,123 | 284,568 | 5,283,305 |
| **Total** | **1,891,049** | **1,870,479** | **422** | **114,272** | **1,111,478** | **21,434,962** |

### Run-level totals

| Metric | Run 1 | Run 2 | Mean | Spread (max-min)/mean |
|---|---:|---:|---:|---:|
| wall_ms | 1,729,758 | 2,052,339 | 1,891,049 | 17% |
| autonomous_ms | 1,465,557 | 2,275,401 | 1,870,479 | 43% |
| input_tokens | 315 | 529 | 422 | 51% |
| output_tokens | 83,066 | 145,479 | 114,272 | 55% |
| cache_creation | 698,858 | 1,524,098 | 1,111,478 | 74% |
| cache_read | 11,917,866 | 30,952,059 | 21,434,962 | 89% |

### The baseline tells us four things

**1. The prompt cache is already very hot.** Cache-hit ratio = `cache_read / (cache_read + cache_creation + input) = 21.43M / 22.55M = 95.07%` on average. **Phase B's nominal "≥70% target" is already exceeded.** What's left for Phase B is cutting the **1.1M tokens per run of `cache_creation`** — the write tax — not lifting the read ratio.

**2. `cache_read` dominates the token bill in absolute terms.** 21.4M cache_read tokens per run is roughly **20× larger than every other token metric combined**. This makes context-compression packages (G.1 pass-by-ID, G.4 compactor + AST + LLMLingua) the highest-leverage levers in absolute-token terms.

**3. Build is the single biggest phase.** Build alone is 50% of wall-clock and 64% of cache_read. Any optimization that touches Build (P14 pre-agent prefetch, P17 parallel fan-out, P19 pass-by-ID, P26 AST retrieval) is high-leverage even if its per-phase percentage is modest.

**4. Run-to-run variance is large.** cache_read varies 89% between two runs; output_tokens varies 55%. **The noise floor is high.** Any single-run measurement claiming <10% improvement is inside noise. This makes Phase A's D4 (variance measurement at N≥5) a hard prerequisite for honest Keep/Drop decisions.

---

## How to read the per-phase estimates

Each phase below has:
- A **table of expected per-metric deltas**, percentage change vs. pre-phase baseline. Range given as best-case / worst-case.
- **Confidence**: how confident I am in the estimate (Low / Med / High).
- **Where the change concentrates** by Loom-lifecycle-phase.
- **Caveats** specific to that phase.

Estimates are **best-effort**, derived from the cited research evidence in `lifecycle-optimizations-research.md`, calibrated against this baseline. **They are not measurements.** Real evaluation may land anywhere in or outside these ranges.

The change is **cumulative against the prior phase's post-eval baseline**, *not* against the original baseline — each Keep promotes the baseline. Where a phase's effect depends on a prior phase having shipped successfully, that's noted.

Negative percentages mean "metric decreased" (better). Positive means "metric increased" (worse, except for `cache_read` where slight increases in early phases are sometimes a sign the cache is amortising better).

---

## Phase A — Telemetry foundation (P1)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | +1% to +3% | High |
| autonomous_ms | +1% to +3% | High |
| input_tokens | 0% | High |
| output_tokens | 0% | High |
| cache_creation | 0% | High |
| cache_read | 0% | High |

**Concentrates:** Evenly across all phases (instrumentation overhead).

**Caveats.** A doesn't optimise; it instruments. The only expected delta is a small wall-clock penalty from telemetry export, which should stay <2% per the seed's quality bar. If A's overhead exceeds 5%, the OpenTelemetry exporter is synchronous — switch to async batch. **A is what makes every later phase measurable** — its D4 (variance σ) becomes the noise floor against which all sub-15% thresholds in later phases are evaluated.

---

## Phase B — Cache hygiene (P2–P5)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | -2% to -5% | Med |
| autonomous_ms | -1% to -3% | Med |
| input_tokens | 0% | High |
| output_tokens | 0% | High |
| cache_creation | **-40% to -70%** | Med-High |
| cache_read | +5% to +15% | Med |

**Concentrates:** cache_creation drops most in Spec/Design/Plan (small phases with few iterations — cache writes dominate). Build and Review show a smaller relative drop because they already amortise the prefix over many calls.

**Caveats.** Baseline cache-hit ratio is already 95%, so the "lift to ≥70%" target named in the rollout doc is meaningless against this baseline. The real win is cutting **1.1M tokens of cache_creation** per run. Best case: P2 + P3 + P4 drive cache_creation to ~330K (70% drop). cache_read may *rise* slightly because more content stays cached. **P5 (subagent cache audit) may collapse to no-op** if Loom dispatches via Claude Code Task tool with sane defaults — in which case the per-subagent first-call savings won't materialise. Estimate assumes P5's pre-investigation finds the bug.

---

## Phase C — Output economy (P6–P9)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | -5% to -10% | Med |
| autonomous_ms | -5% to -10% | Med |
| input_tokens | 0% | High |
| output_tokens | **-15% to -25%** | Med |
| cache_creation | 0% to -3% | Med |
| cache_read | -3% to -8% | Med |

**Concentrates:** output_tokens drops most in Build (53K → 40K-45K) and Plan (22K → 17K-19K) where structured narratives are emitted. Review (18K → 14K-15K) sees a moderate drop. Spec and Design are smaller (~9K-12K each) so less absolute headroom but similar percentage.

**Caveats.** P9 (return-by-reference) is the cache_read contributor — smaller coordinator inbox shrinks the prefix that downstream subagents read. P7 ("be concise") is the biggest output-token lever but its effect is bounded by Phase A's σ — if D4 shows output_token σ ≥10%, the per-package threshold collapses to ≥3σ and may not register. **The biggest risk is P7 cutting too aggressively** — quality bar (D5 diff zero) catches this but it requires running Phase A first.

---

## Phase D — Routing & gating (P10–P13)

| Metric | Expected delta (harness) | Expected delta (dollars) | Confidence |
|---|---|---|---|
| wall_ms | -5% to +5% (net) | — | Med |
| autonomous_ms | -5% to +5% (net) | — | Med |
| input_tokens | 0% | -50% to -80% | High |
| output_tokens | ±5% | -50% to -80% | Med |
| cache_creation | 0% | -50% to -70% | High |
| cache_read | 0% | -50% to -70% | High |

**Concentrates:**
- Coordinator + board-mutation subagents → Haiku: ~70% dollar drop on their slice; barely visible in harness (Coordinator is a fraction of the Build row).
- Spec/Design/Build workers stay on Sonnet: no harness change.
- **Review → Opus: harness shows token counts ~unchanged, but wall_ms +20% to +50% and dollars +200% to +400% temporarily.** Phase D's Review change is *corrected* by Phase G.3 (P23) when the cascade ships; if Phase D ships and Phase G.3 is delayed, expect a temporary Review-cost spike on dollar metrics.

**Caveats.** **Phase D is the clearest example of "harness shows zero impact, dollars drop significantly".** The token counts in the harness are roughly model-agnostic; what changes is the per-token price (Haiku is ~3× cheaper input / ~12× cheaper output than Sonnet; Opus is ~5× more expensive than Sonnet). Document in the per-phase Decision matrix that "Keep" must be evaluated against dollar projections, not harness deltas. If output_tokens does shift, Haiku tends ~5% terser than Sonnet on the same prompt; Opus tends ~5-10% more verbose. **Wall_ms shift on Review is real** — Opus is meaningfully slower than Sonnet per output token, which the harness will reflect.

---

## Phase E — Deterministic shortcuts (P14–P16)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | -10% to -20% | Med |
| autonomous_ms | -10% to -18% | Med |
| input_tokens | -10% to -25% (small absolute) | Med |
| output_tokens | -3% to -8% | Low-Med |
| cache_creation | -5% to -10% | Med |
| cache_read | -10% to -18% | Med |

**Concentrates:**
- Review phase: wall_ms -20% to -30%, all token metrics similar (P15 skip-LLM gate eliminates entire subagent kicks on non-touched paths — Bookmarks is small but auth/* / db/* / mail/* rules will skip subagents for at least one category per run).
- Build phase: cache_read -5% to -15% from P14 pre-agent prefetch (subagent gets shell output up-front, doesn't waste tool calls discovering context).
- Tool-heavy phases (probably Build, possibly Review): cache_creation -5% to -10% from P16 tool-search deferring tool catalogues.

**Caveats.** P15's value depends on what the rule file catches. Bookmarks is a small project — many Review rules may not trigger any skips. Estimate assumes at least 1-2 rule categories skip per run. P14 hits the cache invalidation event of Phase B (different prompt shape), so re-warm cache between Phase B and Phase E evals to compare cleanly. **P16 adds `tool_search` to subagent tool grants — this perturbs the cache prefix locked down in P2.** Co-eval P2's cache-hit ratio after P16 lands; estimate above assumes the perturbation cost is one-shot.

---

## Phase F — Dispatch (P17–P18)

| Metric | If P17 audit finds parallelism already in place | If P17 audit finds serial dispatch |
|---|---|---|
| wall_ms (Build) | 0% | **-30% to -50%** |
| wall_ms (other) | 0% | 0% |
| input_tokens | 0% | 0% |
| output_tokens | 0% | 0% |
| cache_creation | 0% | 0% |
| cache_read | 0% | 0% |
| **Dollars** | -50% on AFK-routed tasks (P18 Batch) | -50% on AFK-routed tasks |

**Confidence:** High on the token columns (P18 Batch is purely a price change). Low on the wall_ms column (depends entirely on whether P17 reveals a fix).

**Concentrates:** Build only.

**Caveats.** **P18 Anthropic Batch API is a 50% price discount, not a token reduction.** The harness will show zero change in token columns from P18. Dollar savings are real and stack with cache discount (cached batch = ~95% off list price). The Build coordinator currently inline-implements tasks (per harness README "Known limitations") which means the Build row is one big row — fewer AFK candidates than the rollout plan assumes. **Reconsider P18's value once Build has actually been refactored to dispatch per-T-NNN subagents** (a separate concern, not in this wave). Until then, P18's headroom is limited to nightly Review sweeps.

---

## Phase G.1 — Pass-by-ID (P19)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | -10% to -18% | Med |
| autonomous_ms | -10% to -18% | Med |
| input_tokens | -5% to +20% (small absolute; read_artifact adds calls) | Med |
| output_tokens | -3% to -8% | Med |
| cache_creation | +3% to +10% (one-shot prefix shift from new tool) | High |
| cache_read | **-25% to -40%** | Med-High |

**Concentrates:**
- cache_read drop is largest in Build (-30% to -45%) and Review (-25% to -35%) — both phases currently receive inlined spec/design content that becomes ID-resolved on demand.
- Spec/Design see small change (they author content, don't read it back).
- Plan sees moderate change (-15% to -25%) — Plan consumes Spec content.

**Caveats.** This is the biggest absolute-token-count lever of the wave. Baseline cache_read 21.4M → 13M-16M. **`read_artifact` adds tool calls** — input_tokens may rise slightly (each tool-call request is small input). Net cost-of-tokens drops because cache_read is the dominant line. **Co-eval P2 cache-hit ratio after P19** — adding `read_artifact` to tool grants is an additive tool-list change. Estimate assumes the re-warmed cache returns to ≥95% hit. P19 has `teardown` rollback class — if Drop, requires explicit cleanup of in-flight artifact-ID references.

---

## Phase G.2 — Retry intelligence (P20–P22)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | -1% to -5% | Low |
| autonomous_ms | -1% to -5% | Low |
| input_tokens | 0% to -3% | Low |
| output_tokens | 0% to -5% | Low |
| cache_creation | 0% to -3% | Low |
| cache_read | -1% to -5% | Low |

**Concentrates:** Wherever retries currently happen. On the Bookmarks baseline, **retries may be rare to non-existent** — the project is structurally simple. If first-attempt success rate is already 100% on the baseline, Phase G.2's full effect is invisible.

**Caveats.** **This phase moves the metrics only if there are retries to optimise.** A simple baseline like Bookmarks may show ~0% change across the harness. The win is real but only when the baseline expands to harder projects. **Confidence is Low** because the estimate depends entirely on baseline retry frequency, which I can't see from the three filed runs (no retry data shown). Recommend running Phase G.2's eval against a *failure-injected* baseline (artificially introduce one-time errors) to confirm the mechanism works, alongside the clean-baseline measurement.

---

## Phase G.3 — Review cascade (P23)

| Metric | Expected delta (vs pre-Phase-D Review baseline) | Expected delta (vs Phase-D Review-on-Opus baseline) |
|---|---|---|
| Review wall_ms | -20% to -40% | -40% to -60% |
| Review autonomous_ms | -20% to -40% | -40% to -60% |
| Review output_tokens | -30% to -50% | -30% to -50% (similar — Opus and Sonnet output similarly verbose) |
| Review cache_creation | -10% to -20% | -10% to -20% |
| Review cache_read | -20% to -40% | -20% to -40% |
| Review dollars | -50% to -70% | -70% to -85% |

**Confidence:** Med-High. FrugalGPT-bracket evidence is solid (research 9.1).

**Concentrates:** Review only. Other phases unchanged.

**Caveats.** **This phase is the corrective for Phase D's Review-on-Opus regression.** If Phase D and Phase G.3 ship close together, the temporary Review-cost spike is brief. If Phase D ships and Phase G.3 is delayed, expect ~+200% Review dollar cost in the interval. P23 quality bar is strict — zero Blockers / Majors missed against D5 (ground truth from Phase A). If even one Blocker slips, P23 is Drop, not Refine — drop and lower the escalation threshold.

---

## Phase G.4 — Active compression (P24–P28)

| Metric | Expected delta (cumulative across all five packages) | Confidence |
|---|---|---|
| wall_ms | -8% to -18% | Med |
| autonomous_ms | -8% to -18% | Med |
| input_tokens | -5% to -10% | Low-Med |
| output_tokens | -3% to -8% | Med |
| cache_creation | -10% to -25% | Med |
| cache_read | **-25% to -45%** (on top of G.1) | Med |

**Concentrates:**
- Phase-boundary handoffs (P24/P25) cut cache_read in the phase *after* each compactor runs. Effect is largest on Plan (consumes Spec+Design summary) and Build (consumes Plan summary).
- AST retrieval (P26) targets Build specifically — Build cache_read -15% to -25% on top of P19.
- LLMLingua-2 (P27) targets doc-ingesting subagents. **If Bookmarks-baseline doesn't have doc-heavy subagents (it likely doesn't), P27 shows ~0% change**; defer or park.
- Code-execution-as-tool (P28) targets multi-tool subagents. Effect depends on baseline tool-call density.

**Caveats.** This is the heaviest infra phase of the wave — compactor subagent, tree-sitter integration, optional LLMLingua service, optional code-execution sandbox. The estimate assumes P24, P25, P26 ship; P27 and P28 may not move the Bookmarks-baseline metrics enough to be Keep. **Re-evaluate P27 and P28 scope after seeing P24/P25/P26 deltas.** Compactor adds new subagent rows in the harness (one row per phase boundary) — these are small (~5K-10K tokens each) but visible. Net cache_read drop should still dominate.

---

## Phase H — Tool-result caching (P29–P31)

| Metric | P29 + P30 only | P29 + P30 + P31 |
|---|---|---|
| Review wall_ms | -5% to -15% | -10% to -20% |
| Review cache_read | -10% to -20% | -15% to -30% |
| Other phases | mostly unchanged | mostly unchanged |
| Build wall_ms | -3% to -8% (from P29 file-cache) | same |

**Confidence:** Med. P31 is parked by recommendation unless P29/P30 don't deliver.

**Concentrates:** Review (test re-runs memoised by P30); Build (file-reads cached by P29).

**Caveats.** Effect on Bookmarks-baseline depends on how many file reads and test re-runs happen per weave. Build of a four-feature app probably reads <20 files and runs the test suite 1-3× — the per-tool absolute savings are modest. **P31's silent-quality-regression risk** (semantic-cache wrong-match) is real; default-park per the seed. If shipped, requires N=100 cache-hit FP-rate sample <3%.

---

## Phase I — Latency UX (P32)

| Metric | Expected delta | Confidence |
|---|---|---|
| wall_ms | **0%** | High |
| autonomous_ms | 0% | High |
| input_tokens | 0% | High |
| output_tokens | 0% | High |
| cache_creation | 0% | High |
| cache_read | 0% | High |

**Concentrates:** Nowhere visible in the harness.

**Caveats.** **Phase I is invisible to the harness.** Streaming changes TTFT (time-to-first-byte) but does not change total wall_ms or any token metric. The win is purely perceived-latency on user-facing phases (Spec/Design). If the harness ever adds TTFT measurement, that's where P32 will show. Until then, Phase I should be evaluated by qualitative user-experience check, not harness metrics.

---

## Cumulative estimate — Loom after the full F/D wave (P1–P32)

Stack the per-phase ranges. Some packages overlap (P19 + G.4 both target cache_read); the cumulative estimate accounts for diminishing returns rather than simple multiplication.

| Metric | Baseline | After full wave (best) | After full wave (worst) | % change (best) | % change (worst) |
|---|---:|---:|---:|---:|---:|
| wall_ms | 1,891,049 | 1,040,000 | 1,420,000 | **-45%** | **-25%** |
| autonomous_ms | 1,870,479 | 1,120,000 | 1,500,000 | -40% | -20% |
| input_tokens | 422 | 320 | 400 | -24% | -5% |
| output_tokens | 114,272 | 68,000 | 86,000 | **-40%** | **-25%** |
| cache_creation | 1,111,478 | 500,000 | 780,000 | **-55%** | -30% |
| cache_read | 21,434,962 | 6,400,000 | 10,700,000 | **-70%** | **-50%** |

**Best-case dollar impact (rough, not in the harness).** With baseline at ~95% cache hit, the dominant cost line is currently `cache_read` (21.4M × $0.30/MTok = ~$6.43 per run at Sonnet rates). Post-wave best case lands `cache_read` at ~6.4M (~$1.92), `output_tokens` at 68K with mixed Haiku/Sonnet/Opus tiers (~$0.50-$1.00), `cache_creation` at 500K (~$1.88). **Per-run dollar cost roughly drops from ~$12 to ~$4–6** at Sonnet rates if Haiku coverage on Coordinator + board mutations is broad. Phase F P18 (Batch) and Phase D's Haiku routing land additional dollar savings invisible in the harness.

**Worst-case scenario.** Several packages Drop on quality bars (P31, P27, P28 if Bookmarks doesn't expose enough doc-heavy / multi-tool subagents). Phase G.2 contributes ~0% on a simple baseline. The realistic worst case is "wall_ms and token counts each drop ~25%" — still material, but well short of the best case.

**Realistic mid-range expectation.** Wall_ms -35%, cache_read -60%, output_tokens -30%, cache_creation -40%. That's the configuration the wave was designed to produce.

---

## Sensitivity / variance notes

**Run-to-run baseline variance is 17-89% depending on metric.** Single-run measurements are not reliable. The wave's design assumes Phase A's D4 publishes σ at N≥5 and all sub-15% thresholds restate as ≥3σ; before that lands, don't accept any Keep/Drop decision on a thin delta.

**Build dominates the variance.** Run 1's build output is 33K tokens; run 2's is 73K. The same project produces 2.2× different Build cost across runs. **Optimizations that target Build are most affected by this variance** — their measured impact will swing widely.

**The baseline is a small project.** Bookmarks is ~four-feature single-process app. Some optimizations (P19 pass-by-ID, P27 LLMLingua, P28 code-execution) have larger relative impact on bigger projects with more spec/design content and more tool-call density. The Bookmarks-baseline estimate is conservative for those packages.

**Phase G.2 effect is invisible on a clean baseline.** If first-attempt success rate is 100% on Bookmarks (likely), Phase G.2 shows zero harness movement. Recommend a parallel failure-injection eval to confirm the retry mechanism works.

**Phase D and Phase F P18 dollar savings are invisible in the harness.** Document explicitly in the per-package Decision matrix that "Keep" must consider dollar projection, not just harness deltas. Otherwise these phases look like zero-impact when they're not.

---

## How to compare actual measurements against these estimates

After each phase ships and the eval harness re-runs (via `pnpm run eval:run` then `pnpm run eval:analyse`):

1. **Read `analytics/<version>/<run>/usage.md`** for the per-phase totals.
2. **Diff against the prior version's per-phase totals.** Same metric, same phase, same run-count if pooled.
3. **Compare the percentage delta against this doc's range for that phase.**
4. **Inside the range** → Keep is likely correct. **Below the range** → Refine; check whether prerequisite phases shipped correctly (e.g., D4 variance is published, P5 pre-investigation ran, P2 cache locked). **Above the range** → unexpected upside; investigate before crediting (could be measurement noise, not real win).
5. **For Phase D and F P18:** projected dollar deltas need a separate calculation outside the harness. Apply Anthropic per-token prices to the harness counts, then apply the model-tier and Batch discounts based on the routing table that's in effect.

---

## What this doc is not

- **Not a forecast.** Best-effort estimates calibrated against three baseline runs. Real measurements may land outside the ranges in either direction.
- **Not exhaustive.** Phase G.4's P27 (LLMLingua) and P28 (code-execution-as-tool) effects on Bookmarks-baseline are speculative; their value may be near-zero on this baseline and substantial on a different project.
- **Not a substitute for running the eval.** These ranges are sized to inform planning, not replace measurement.
- **Not pricing analysis.** Dollar projections are illustrative at Sonnet 4 rates as of 2026-05; actual dollars depend on which models are routed where, current pricing, and how much of the AFK workload runs through Batch.
