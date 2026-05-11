---
project: loom-restructure-v2
date: 2026-05-11
phase-context: design (in-progress, pre-cutover)
reviewer: claude
inputs:
  - loom/ (working tree)
  - forge/ (working tree, partial — forge/craft/ already deleted)
  - .forge/loom-restructure-v2/{idea.md, design.md, decisions.md}
  - docs/, loom/docs/
---

# Loom v2 — Pre-Cutover Review

## TL;DR

Structure, pipeline schema, phase contracts, SR-1/SR-2/SR-4 all clean. Three load-bearing carry-forwards from `forge/` were rewritten/shrunk instead of carried verbatim, contrary to design §11.2 and §11.1: `principles.md`, `idea/categories.md`, `idea/grilling-rules.md`. `/explore-prototype` lost its executable Puppeteer contract. Docs duplicated in two trees. Several minor contract gaps (D-13 enforcement, `.locks/` lib, rerun cascade).

## Verdict Matrix

| Area | Plan adherence | Forge parity | Docs alignment |
| --- | --- | --- | --- |
| Phase folder shape + agent/schema/contract | ✅ | n/a | ✅ |
| Pipeline.md shape + parser + 4-status vocab | ✅ | n/a (new contract) | ✅ |
| Build agents (coordinator + task-builder + smoke + mutate) | ✅ | partial (TDD detail thinner) | ✅ |
| Quality Check Agent | ✅ structure / ⚠️ findings-cascade underspec | n/a (new) | ⚠️ no own doc page |
| SR-2 audit (forge/craft/temper strings) | ✅ zero hits | n/a | ✅ |
| SR-4/SR-5 setup + symlinks | ✅ | ✅ | ✅ |
| Three-tier context (principles + types + constitution) | ✅ structure / ❌ principles content | ❌ principles condensed | ⚠️ |
| Idea question-quality contract | ✅ rule names / ❌ templates | ❌ categories.md gone | ⚠️ |
| /tune | ✅ frozen as designed | ❌ entire skill placeholder | ❌ not in overview |
| /explore-prototype | ✅ public utility kept | ❌ Puppeteer detail gone | ❌ not in overview |
| Review dual-write to global shards | ⚠️ agent declares, schema doesn't enforce | n/a | ❌ not in docs |
| Lib (parser, events, artifacts, locks, atomic-write) | ✅ for project lock / ❌ `.locks/T-NNN.lock` | partial (no render-summary, no usage-diff) | n/a |
| Docs tree | n/a | n/a | ❌ duplicated `/docs/` + `/loom/docs/` |

---

## Gap 1 — `principles.md` shrunk against carry-forward intent

**Severity:** major (regression vs. design §11.2: "carries forward 1:1")

**What:** `forge/principles.md` = 198 lines with concrete rules per P1–P7, self-check questions, Phase-5 review-flag rules. `loom/principles.md` = 84 lines, condensed bullets.

**Lost content:**

- Per-principle self-check questions (P1: *"If I removed this line, would a documented requirement fail?"*; P2: *"Would a senior on this team recognise the style?"*).
- Per-principle Phase-5 review-flag rules (e.g., P3: "3 substantially-similar code blocks = MAJOR finding").
- The Phase-4 build preamble (the long version with consumer guidance, not the 7-bullet short one).
- The Phase-5 review checklist's BLOCKING/MAJOR/MINOR severity mapping.

**Why it matters:** principles.md is loaded as preamble into every Task Builder dispatch and used as a structured checklist by Review (per design §11.2). The condensed bullets are not enforceable — Review can't flag "violates P3" without the 3-occurrence rule explicit.

### Options

| Opt | Action | Cost | Effect |
| --- | --- | --- | --- |
| A | Replace `loom/principles.md` with `forge/principles.md` content verbatim (SR-2 string scrub only) | Low | Full carry-forward; design intent honoured |
| B | Keep current condensed file, add a `principles-full.md` for review-mode use | Medium | Two files diverge over time |
| C | Stay as-is, accept Review-checklist regression | Free | Documented regression |

**Recommendation:** **A**. The design explicitly said carry-forward. The condensed version is a change the design did not authorise.

### Answer

<!-- user fills -->

---

## Gap 2 — `forge/idea/categories.md` not migrated

**Severity:** major (load-bearing for Idea phase quality)

**What:** `forge/idea/categories.md` (224 lines) defined per-category briefing templates, the option-line format (`(A) [Effort, Risk] name — outcome`), word caps (issue 30–80, background 50–200, etc.), and a YAML validation schema for each category. No equivalent exists in `loom/`.

`loom/weave/idea/grilling-rules.md` keeps the named categories (Y/N, Choice, Architecture, Background, Open) but has zero template/validation content. The Idea agent has the *names* but not the *contract*.

**Architecture of the loss:**

```
forge/idea/categories.md (the contract)
├── Briefing block template (What's the issue: / Current behavior: / Options:)
├── Per-category specifics (word caps, diagram requirement for C, ...)
├── Per-category templates (A: YES/NO rows, B: 3-5 options, C: ≥3 components → diagram, ...)
├── Stage badge format (`Q4 [Branching 2/8 · Y/N]`)
├── Triage logic (demote from D → B → A when possible)
└── Validation summary (YAML schema with word_min/word_max/option_counts)
                       │
                       ▼
                  loom: nothing
```

**Why it matters:** without the briefing-block discipline and per-category word caps, the agent reverts to "what do you think?" style questions. The forge contract was the mechanism that made Idea questions decision-ready instead of round-trippy.

### Options

| Opt | Action | Cost | Effect |
| --- | --- | --- | --- |
| A | Port `forge/idea/categories.md` → `loom/weave/idea/categories.md` (SR-2 scrub; truth-named categories already match) | Low | Full contract restored |
| B | Fold templates+validation into `loom/weave/idea/grilling-rules.md` (single-file Idea contract) | Medium | One file gets long; aligns with truth's per-phase-folder pattern |
| C | Reference forge's content via git history; expect agent to internalise from training | Free | Regression; not a contract |

**Recommendation:** **B**. Single-file Idea contract is more discoverable for the agent reading `loom/weave/idea/grilling-rules.md`. Section structure: §1 question quality (current), §2 categories + per-category templates + word caps (new from forge/categories.md), §3 stage badges (new), §4 stop rules (current), §5 revisit rules (current), §6 dispatch flow (new from forge/grilling-rules.md §4). Keep file ≤300 lines.

### Answer

<!-- user fills -->

---

## Gap 3 — `grilling-rules.md` lost the "how to run a grilling loop" mechanism

**Severity:** major (Idea phase can't execute)

**What:** `forge/idea/grilling-rules.md` = 293 lines. `loom/weave/idea/grilling-rules.md` = 44 lines. The 6-rule list and stop/revisit rules made it; everything operational did not.

**Lost content:**

- AskUserQuestion dispatch table (picker entries: `Answer`/`Explain more`/`Stop`/`side requirement: <text>`/`push back: <text>`).
- Slot-body parsing rules (`[push back: ...]` / `[stop]` conventions).
- Markform answer-slot template for `decisions.md` (HTML comment markers, body invariants).
- Revisit caps (max 2 revisits per Q, max 3 open threads, revisits count toward budget).
- Hard stop caps (12-question total, force-end on 3 consecutive `Stop` clicks).
- Autonomous mode (`FORGE_AUTO` → auto-pick the recommendation).
- Required Phase-1 outputs (idea.md ≤2 KB, decisions.md parseable, develop-log entry).
- Foundation/Branching budget math (`Branching budget = 12 − foundation_q_count`).

**Why it matters:** the Idea agent reads grilling-rules.md as its operational manual. Without these, "call AskUserQuestion directly" is underspecified — the agent has no menu structure, no slot conventions, no caps. Concrete failure: the loom agent doesn't know how to record a `[push back: ...]` response, so user pushback would lose its parseability.

### Options

| Opt | Action | Cost | Effect |
| --- | --- | --- | --- |
| A | Carry forward forge's §4 (dispatch), §5 (revisit mechanic), §6 (slot template), §7 (hard caps), §8 (required outputs) — SR-2 scrub (`forge:question` → `loom:question`) | Low | Full mechanism restored |
| B | Spec only the slot template and dispatch menu; drop revisit/caps as redundant with truth's stop rules | Medium | Looser contract; risk of regression on revisits |
| C | Stay as-is | Free | Idea agent operates by interpretation, not contract |

**Recommendation:** **A**. The 6 rules made it from truth; the mechanism for *applying* the 6 rules is forge's contribution and should carry forward. Drop `FORGE_AUTO` (no equivalent in loom; reopen if needed). Rename markers `forge:question`/`forge:answer-slot` → `loom:question`/`loom:answer-slot` (already done in artifact-contract.md).

### Answer

<!-- user fills -->

---

## Gap 4 — `/explore-prototype` lost its executable contract

**Severity:** major (skill can't run as-is)

**What:** `forge/explore-prototype/SKILL.md` = 203 lines. `loom/explore-prototype/SKILL.md` = 35 lines. The analysis template carried over; the procedure didn't.

**Lost content:**

- Puppeteer MCP infrastructure setup (install `@modelcontextprotocol/server-puppeteer`, create `.mcp.json` entry, verify availability, restart Claude Code).
- The base64 → disk screenshot helper script (`/tmp/save_puppeteer_screenshot.py`) — without it screenshots overflow into context.
- Phase 1 automated crawl rules (depth cap 3, same-origin, unique-state screenshots, naming conventions).
- Phase 2 user-guided follow-up (login credentials, missed flows, role-based exploration).
- Phase 3 source-scan scope table (routes/models/config IN; business logic/tests/styling OUT).
- The throwaway-prototype labelling discipline (every code-derived finding prefixed `⚠️ Inferred from throwaway prototype`).

**Why it matters:** the agent can't crawl a prototype from the 35-line version. It will hit a missing MCP, won't know how to save screenshots, and won't know the source-scan boundary.

### Options

| Opt | Action | Cost | Effect |
| --- | --- | --- | --- |
| A | Carry forward forge's SKILL.md verbatim (SR-2 scrub: `forge/` paths → `loom/`, `.forge/<project>/` → `.loom/<project>/`) | Low | Full mechanism restored |
| B | Carry forward only Phases 1/3/4 (drop the Puppeteer MCP setup; assume user pre-installs) | Medium | Setup friction on first use |
| C | Stay as-is | Free | Skill is documentation-only, not runnable |

**Recommendation:** **A**. Same reasoning as Gap 3 — the procedure is the value.

### Answer

<!-- user fills -->

---

## Gap 5 — Duplicate doc trees (`/docs/` and `/loom/docs/`)

**Severity:** minor (alignment, not functionality)

**What:** Two near-identical doc trees:

```
/docs/
├── overview.md
├── tune/      (empty)
└── weave/
    ├── weave.md, idea.md, design.md, plan.md, build.md, review.md
                                                                    (all 6 identical)
/loom/docs/
├── overview.md   ← differs only in link targets: `../weave/idea/agent.md`
└── weave/
    └── (same 6 files, identical content)
```

**Diff (only material difference is link paths in overview.md):**

```diff
-| Idea Grilling Agent | [`weave/idea.md`](weave/idea.md) | ...
+| Idea Grilling Agent | [`../weave/idea/agent.md`](../weave/idea/agent.md) | ...
```

**Why it matters:** the design said (§14.3) docs is "alignment, not rewriting" — one canonical location, not two. Two trees diverge over time.

### Options

| Opt | Action | Cost | Effect |
| --- | --- | --- | --- |
| A | Keep `/docs/` (repo-level, links within itself, public-facing); delete `/loom/docs/` | Low | One truth; matches design §14.3 wording ("`docs/` already describes…") |
| B | Keep `/loom/docs/` (framework-local, links back to implementation); delete `/docs/` | Low | One truth; framework owns its docs |
| C | Keep both, make `/loom/docs/` a symlink or shim | Medium | Avoids drift; introduces a symlink dependency |

**Recommendation:** **A**. Design §14.3 explicitly cites `docs/` (no `loom/` prefix) as the alignment target. Repo-level docs are the public surface; framework internals shouldn't shadow them.

### Answer

<!-- user fills -->

---

## Gap 6 — D-13 dual-write declared by agent, not enforced by contract

**Severity:** moderate (silent regression risk)

**What:** Design §10.1 mandates Review writes both project-local files AND appends to global `loom/log/{audit,build,feedback,ideate}.md`. `loom/weave/review/agent.md:22` declares the writes. But `loom/weave/review/artifact-contract.md` doesn't list the shard appends as required, and `loom/weave/review/schema.yaml` doesn't include them in `artifacts`. A Review that skips the dual-write passes Quality Check.

**Flow:**

```
Review agent ──writes──┬─→ review.md          ✓ contract requires
                       ├─→ feedback.md        ✓ contract requires
                       ├─→ develop-log.md     ✓ contract requires
                       ├─→ loom/log/audit.md  ❌ contract silent
                       ├─→ loom/log/build.md  ❌ contract silent
                       ├─→ loom/log/feedback ❌ contract silent
                       └─→ loom/log/ideate.md ❌ contract silent
                                ▲
                       Quality Check skips here
```

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Add to `review/artifact-contract.md`: "If `develop-log.md` contains learning observations, matching `## YYYY-MM-DD — <project> — <topic>` entries must exist in `loom/log/<shard>.md`. QC verifies the append landed." | Low |
| B | Add `learning-appends: [...]` field to `review/schema.yaml` RETURN block; QC checks the listed paths grew | Low |
| C | Stay as-is, rely on agent discipline | Free |

**Recommendation:** **A**. Cheap; contract-level enforcement. Add one section to `artifact-contract.md`.

### Answer

<!-- user fills -->

---

## Gap 7 — `.locks/T-NNN.lock` declared by task-builder, no lib helper

**Severity:** moderate (runtime fragility)

**What:** `loom/weave/build/task-builder.md:24` declares "Acquire `.loom/<project>/.locks/T-NNN.lock`". `loom/lib/locks.sh` only implements the project-level `.lock` directory. No helper exposes per-task locks.

**Behaviour today:** task-builder agent ad-libs a lock mechanism per dispatch. Two parallel task-builders racing on the same T-NNN could both think they hold the lock.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Extend `loom/lib/locks.sh` with `acquire_task_lock <project> <task-id>` / `release_task_lock <project> <task-id>` (mkdir-based atomic, same pattern as project lock) | Low |
| B | Drop parallel-build aspirations; serialise task-builder dispatches in Build Coordinator; remove `.locks/` from design | Medium |
| C | Stay as-is; document that parallel batch (design §9.2 "max three concurrent tasks") requires user-enforced disjoint file scope | Free |

**Recommendation:** **A**. Build Coordinator can dispatch parallel batches per design §9; without a lib helper, the lock contract is wishful.

### Answer

<!-- user fills -->

---

## Gap 8 — Foundation budget recorded, never surfaced

**Severity:** minor (UX regression)

**What:** `loom/weave/create-project.md:11` computes Idea Foundation budget from seed density (sparse: 5 / moderate: 3 / dense+value-bar: 1 / dense: 2). `pipeline-parser.py` stores it in `Phase budget`. But `loom/weave/idea/agent.md` doesn't read it, doesn't show stage progress in questions, and doesn't enforce the budget.

Forge's stage-badge format `Q4 [Branching 2/8 · Y/N]: ...` is gone. Users have no signal that the agent is at 4/5 Foundation questions or 8/8 Branching questions.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Restore stage-badge format in question text; Idea agent reads `Phase budget` from pipeline.md, tracks Foundation/Branching counts in `decisions.md`, includes progress in the question header | Medium |
| B | Drop `Phase budget` field entirely; trust the agent to stop when ambiguity stabilises | Low |
| C | Stay as-is (field exists, not used) | Free |

**Recommendation:** **A**. The budget+badge is forge's main contribution to grilling-loop calibration; restoring it pairs with Gap 3 (full grilling-rules carry-forward).

### Answer

<!-- user fills -->

---

## Gap 9 — QC findings → rerun cascade underspecified

**Severity:** moderate (orchestrator behaviour ambiguous)

**What:** `loom/weave/SKILL.md:54` says "Ask the user whether to rerun the phase or continue." `loom/weave/quality-check/agent.md:35` says "If the user chooses rerun, keep current phase and pass findings to that agent." But neither doc specifies *how* findings are passed: as a string injected into the next dispatch prompt? As an updated `pipeline.md` field the phase agent reads? As an extra read-input?

Design §6.4 cascades: "user picks rerun → orchestrator either re-dispatches the phase agent (with the findings as additional context) or advances `current.phase`." "Additional context" is the ambiguous part.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Spec: QC writes findings to `pipeline.md` "Quality findings" section (already done); orchestrator's rerun dispatch passes a flag `--with-findings` (or equivalent prompt fragment) instructing the phase agent to read that section first | Low |
| B | Spec: orchestrator inlines the findings into the phase agent's dispatch prompt verbatim; pipeline.md keeps the audit copy | Low |
| C | Stay as-is, agent reads pipeline.md anyway | Free |

**Recommendation:** **A**. Pipeline.md as the single source for findings (matches the "audit/recovery surface" pattern used for decisions.md). Document the dispatch flag in `weave/SKILL.md` and the phase agents' `Reads` lists.

### Answer

<!-- user fills -->

---

## Gap 10 — `/tune` and `/explore-prototype` invisible in `docs/overview.md`

**Severity:** minor (discoverability)

**What:** `docs/overview.md` lists `/weave` and the 5 phase agents. `/tune` (frozen placeholder, user-invocable per its SKILL.md) and `/explore-prototype` (public utility per D-09) are not mentioned. Users invoking `/help` or reading the overview won't know they exist.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Add "Other skills" section to `docs/overview.md`: `/tune` (frozen) + `/explore-prototype` (Design-evidence utility) | Low |
| B | Stay as-is; the README lists them | Free (but README also doesn't list `/tune` or `/explore-prototype`) |

**Recommendation:** **A**. Two lines in overview.md.

### Answer

<!-- user fills -->

---

## Gap 11 — Build TDD detail thinner than forge

**Severity:** minor (Task Builder discipline)

**What:** `forge/build/tdd.md` (a companion file) had explicit Red-phase rules (stub signatures, assertion-error requirement, compile-error handling), Implementation rules with embedded P1–P7 self-check, "What 'done' means" 5-item completeness contract, and the tail-100 verbose-output rule with exact piping syntax.

`loom/weave/build/task-builder.md` keeps Lock/Red/Implement/Green steps and the 3-attempt cap but is terser. Specifically loses: the explicit "Red is runtime assertion failure, not compile failure" wording (kept but no longer flagged as Hard Rule #1 the way forge did); the tail-100 piping example; the "done means all 5 of these happened" completeness check.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Add `loom/weave/build/tdd.md` companion file carrying forward forge's discipline; task-builder.md references it | Medium |
| B | Inline the missing rules into task-builder.md (extend file by ~30 lines) | Low |
| C | Stay as-is | Free |

**Recommendation:** **B**. Single-file Build Builder contract avoids extra read; adds ~30 lines for tail-100 piping, "done" 5-item check, and explicit Red-phase wording.

### Answer

<!-- user fills -->

---

## Gap 12 — `loom/lib/` missing `render-summary` and `usage-diff`

**Severity:** minor (tooling)

**What:** `forge/lib/render-summary.sh` (per-project rolling summary) and `forge/lib/usage-diff.sh` (token-delta between dispatches) have no loom equivalents. Quality Check writes `summary.md` per design §6.2, but no library helper exposes summary rendering on demand. The usage-*.sh hooks record raw tokens but no aggregation helper.

### Options

| Opt | Action | Cost |
| --- | --- | --- |
| A | Port both forge helpers (SR-2 scrub: `.forge/` paths → `.loom/`, drop `forge` strings); QC agent calls render-summary at end | Medium |
| B | Drop both; Quality Check writes summary inline; usage telemetry stays raw | Free |
| C | Port only render-summary (the more user-facing one) | Low |

**Recommendation:** **C**. Summary refresh on demand is useful for UI/audit/CI. Token-delta is forge-ui-specific and that's deferred. Reopen usage-diff when/if loom-ui lands.

### Answer

<!-- user fills -->

---

## Cutover Pre-Flight Checklist (post-fixes)

| Check | Pass criterion |
| --- | --- |
| SR-1 | `loom/` has flat siblings only; no `runtime/` parent |
| SR-2 | `rg "forge\|craft\|temper" loom/` returns zero hits |
| SR-3 | Cutover commit deletes `forge-ui/` (already deleted in working tree) |
| SR-4 | `loom/setup-loom.sh` idempotent; settings.json updated via jq merge |
| SR-5 | `~/.claude/skills/{weave,tune,explore-prototype}` symlinks point into `loom/` |
| SR-6 | Per-source executive-summary survival: principles.md, categories.md, grilling-rules.md, explore-prototype/SKILL.md all carry forward |
| SR-7 | `loom/weave/SKILL.md` is the single entrypoint; progressive disclosure to find/create/recovery/phase agents |
| SR-8 | `.forge/<project>/` untouched in the cutover diff |
| Smoke | A new `/weave` project can run Idea → Quality Check → user decision end-to-end on the new tree |
| Docs | One doc tree, link targets resolve, overview lists all user-invocable skills |

## Recommended Sequence

1. **Gaps 1, 2, 3, 4** (carry-forward regressions) — fix before cutover.
2. **Gap 5** (docs duplication) — pick one tree.
3. **Gaps 6, 7, 9** (contract enforcement + lib + rerun cascade) — close before cutover.
4. **Gaps 8, 10, 11, 12** (UX/discovery/tooling polish) — nice-to-have, can land in a follow-up project if cutover is time-pressured.

Items 1–3 are load-bearing for "scope preserved"; item 4 is quality-of-life.
