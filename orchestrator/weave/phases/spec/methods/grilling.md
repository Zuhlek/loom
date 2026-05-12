# Grilling Rules

Spec-phase grilling discipline. Every question is a structured artifact validated against the schema in [`categories.md`](categories.md). This file specifies the rules around HOW questions get generated, sequenced, answered, and revisited.

---

## 1. Six "good question" criteria

Self-check before presenting any question:

| # | Criterion | Wrong-answer test |
|---|---|---|
| **G1** | Decision-relevant. A different answer changes the next step. | If both answers lead to the same plan, skip the question. |
| **G2** | Self-contained. | If you have to say "as we discussed in Q2…", restructure or merge. |
| **G3** | Briefed. Briefing block complete and visible up-front. | If the user has to ask `[explain more]` to understand the issue, the cause, or the option trade-offs, the briefing was lazy. See §1.5 and [`categories.md`](categories.md). |
| **G4** | Opinionated. Recommendation included with reasoning. | Never *"what do you think?"*. Always *"I recommend X because Y."* If the recommendation is *"either is fine"*, this isn't a decision — skip it. |
| **G5** | Singular. One thing at a time. | If the question uses "and" or "or", split it. |
| **G6** | Decidable now. | If only the codebase can answer it, dispatch an `Explore` subagent — don't ask the user. |

A question failing any criterion is regenerated, not presented.

---

## 1.5. Briefing block discipline

Every question — Y/N, Choice, Architecture, Background, Open — opens with a three-section briefing the user reads before answering. The full template lives in [`categories.md`](categories.md) §"Briefing block". The discipline:

| Rule | Why |
|---|---|
| The briefing is part of the question text written into the `## Q<n>` block in `decisions.md`. | The user reads the briefing in the UI (or in raw markdown) before filling the answer slot — no follow-up round-trip required. |
| **Plain-text discipline.** Question briefings render in the UI's plain-text panes and in raw markdown — keep them robust to either surface. Use trailing-colon section labels (`What's the issue:`), indent option lines, separate option-name from outcome with `—` (em-dash). The full options table (with Effort / Risk / Result columns) lives in the structured `**Options at a glance**` markdown table that the parser reads — not in the prose briefing. | Plain-text labels read correctly in both surfaces; the structured table is for the parser, not the human reader. |
| Lead with `What's the issue:` in plain language. No internal jargon, acronyms, or feature codenames the user wouldn't see in the bug report. | The first sentence sets whether the user's brain engages or skims. |
| `Current behavior / what's causing it:` is grounded in observable facts. Reference file:line if the question stems from code. For Architecture questions, embed a small mermaid or 5-line ASCII diagram. | Recommendations land softer when the user can verify the cause for themselves. |
| `Options:` is an indented list, one line per option, prefixed `(A) [Effort, Risk]  <name> — <result ≤120 chars>`. Effort = S\|M\|L; Risk = Low\|Med\|High. | Lets the user weigh trade-offs without reading prose; renders cleanly even in plain-text terminals. |
| `Recommendation:` and `Why not the others:` go LAST as two single-line entries, after the user has read issue → cause → options. | Reading the recommendation first anchors the user; presenting it last lets them form a view, then check it against the agent's pick. |
| If a briefing field would repeat the question text, the question is malformed — rephrase the question or merge fields. | Repetition signals you didn't add information. |

Word caps (per [`categories.md`](categories.md) §"Validation summary") are hard limits. Briefings that overflow are rewritten before being shown.

The briefing is what changes Spec from "the user has to interrogate the agent to understand each question" to "the user reads the briefing once and answers." Long briefings are fine; *unstructured* briefings are the thing to avoid.

---

## 2. Two sub-phases: Foundation, then Branching

Grilling is **staged** — a direct application of the Double Diamond framework. Foundation = Problem Space; Branching = Solution Space. Build a model of the user's world before asking decision questions about the new work.

### Sub-phase 1: Foundation (Problem Space)

Gather context. **No decisions yet.**

Read `repo-context.md` (produced by the Spec agent's repository pre-flight — see `phase.md` Work Loop step 2) before generating Foundation questions. Never ask the user for a fact the repo states directly — pull it from `repo-context.md` and treat it as established. Foundation questions fill the gaps the repo cannot answer (team context, value bar, constraints not in code).

- Existing situation — current architecture, team, prior choices, integration points.
- Value bar — what does "done" mean? what is the success criterion?
- Constraint envelope — performance, compliance, compatibility, regulatory.

Typical categories: **Background** and **Open**. Sometimes **Architecture** when the existing system needs sketching. **Y/N** is rare here — Foundation paints the picture, not chooses.

**Exit Foundation when:** two questions in a row add nothing new to the understanding model, OR the user signals they have enough context.

### Sub-phase 2: Branching (Solution Space)

Explore the decision space.

- Scope — what's in / out?
- Approach — which architectural path?
- Implementation choices — naming, integration, defaults.

Typical categories: **Y/N**, **Choice**, **Architecture**. Foundation answers inform every Branching recommendation.

**Exit Branching when:** ambiguity stops surfacing, OR the user signals "enough" (clicks `Stop`).

### Why staging matters

If Branching runs before Foundation, recommendations are wrong. The agent will recommend "use TypeScript" without knowing the user is on a Python team.

The agent MAY re-enter Foundation mid-Branching if a Branching question reveals a missing foundational fact. Rare, not forbidden.

---

## 3. Triage logic — what to ask next

```
1. Are there foundation_topics_remaining?  → ask one.
2. Are there active_revisits queued?       → handle one (see §5).
3. Are there branching_topics_remaining?   → ask one (per categories.md triage).
4. Otherwise:                              → return artifacts to the orchestrator.
```

---

## 4. `AskUserQuestion` dispatch

The Spec Grilling Agent surfaces every question via `AskUserQuestion` and runs the entire grilling loop inside a single Task dispatch — generate Q, surface, persist the answer, generate the next Q, surface, persist, … — exiting only on `phase-complete` (close branch) or `stop-requested` (user picked Stop).

`decisions.md` is the audit / recovery surface, not the primary answer surface — every answer is mirrored into the matching `<!-- loom:answer-slot -->` region as it is captured.

### AskUserQuestion field mapping

The agent populates the picker so the user can answer without opening `decisions.md`. Briefing fields fan out across the picker:

| `AskUserQuestion` field | Loom briefing source |
|---|---|
| `question` | Question heading + the briefing block's `What's the issue:` sentence (the user reads this first). |
| `options[].label` | Option letter / `YES` / `NO`. The recommended option's label carries a trailing ` (Recommended)` suffix. |
| `options[].description` | The option's one-line outcome from the Options list (the `— <result ≤120 chars>` segment). Brings the per-option trade-off into the picker without forcing the user to expand. |
| `preview` | The Architecture diagram (mermaid or ASCII) for Architecture-category questions; the per-option implication snippet for Choice questions when it materially differs from `description`; omitted otherwise. |

The picker therefore carries the full *What's the issue / Current behavior / Options / Recommendation* surface — the user does NOT need to open `decisions.md` to answer. `decisions.md` is the audit trail and recovery surface only; users are not expected to edit it by hand.

The user's response options map onto picker entries and a free-text fallback:

| Action | Surface |
|---|---|
| `(A)` / `(B)` / `YES` / `NO` / `Accept this direction` — direct answer | Picker entry. The recommended option's label carries a `(Recommended)` suffix. The agent strips the suffix and writes the option name to the slot via `orchestrator/lib/atomic-write.sh`. Status flips to `answered`. |
| `Explain more` | Picker entry. The agent composes a 2–4 sentence elaboration grounded in the existing briefing and re-calls `AskUserQuestion` with the same options + the elaboration appended to the `question` field. Hard cap: **4 elaborations per Q** (raised from 2 — the user can iterate on understanding before being forced to commit). On the 5th attempt, write `[push back: needs more context]` to the slot. |
| `Explain more: <focus>` | Free-text fallback. Same as `Explain more` but the agent focuses the elaboration on `<focus>` (the user's specific area of confusion — e.g., `Explain more: how does this affect deployment?`). Counted against the same 4-elab cap. |
| `Stop` | Picker entry. The agent writes `[stop]` to the slot and exits the loop with `STATUS: stop-requested`. The next `/weave` kick force-ends Spec via the close branch, writes `spec.md` with whatever's resolved, and emits `phase-complete`. |
| `side requirement: <text>` | Free-text fallback. The agent appends `SR-<n>: <text>` to the `## Side requirements (running)` section and re-calls `AskUserQuestion` (same Q, no answer captured yet). |
| `push back: <text>` | Free-text fallback. For genuine objection to the framing or recommendation — NOT for "I want more info" (use `Explain more: <focus>` instead). The agent writes `[push back: <text>]` to the slot and continues the loop. The next iteration parses the bracket-prefix, runs the consistency pass (§5), and generates a `Q<n>'` revisit. |
| Any other free text | Treated as a direct answer. The agent writes the text verbatim to the slot. Status flips to `answered`. |

`Show alternatives` is intentionally out of scope — the `AskUserQuestion` picker has a hard cap of 4 options, and once 1–3 answer choices + `Explain more` + `Stop` have taken slots, there is no room left.

`Defer` and `Skip` are not options. `Skip` was functionally identical to clicking the recommended answer; `Defer` left `[NEEDS CLARIFICATION]` markers in `plan.md` that never got resolved. A question worth asking is worth answering or pushing back on.

**Slot-body parsing rules** (used by the next `/weave` kick when it re-enters the agent for recovery):

- A slot whose body matches `\[(push back|stop)(:\s.*)?\]` → dispatch the matching action.
- Any other non-whitespace body → direct answer; flip `Status: answered`.
- An empty slot OR the literal placeholder `*(awaiting user answer)*` → recovery: re-surface the existing question (this only fires after a crash mid-`AskUserQuestion`).

---

## 5. The revisit mechanic

Alignment requires updating earlier answers when later answers contradict the assumptions they were resting on.

### When a revisit is triggered

After every resolved answer, run a consistency pass against prior answers. **Strict trigger:**

> Flag a revisit if and only if the new answer would have **flipped** the prior recommendation, not merely enriched its reasoning.

| Trigger | Example |
|---|---|
| Prior recommendation would flip | Q3 said NO TypeScript (faster). Q12 establishes regulatory type-safety. → Q3 flips YES. |
| Prior trade-off no longer applies | Q5 picked Redis (low ops cost). Q14: full DevOps team. → cost argument moot. |
| Prior assumption contradicted | Q2 assumed single-threaded. Q11 reveals 10× concurrency. → Q2's choices need redo. |
| Prior scope decision obsolete | Q4 included mobile. Q9: drop mobile. → Q4 marked obsolete, not revisited. |

**NOT triggers:** new info enriches reasoning but answer would still be the same; orthogonal info; nuance already captured.

### How the revisit surfaces

Before asking the next normal question:

```
🔁 Reconsidering Q<n> in light of Q<m>.

Q<n> [<category>]: <question>
  Earlier you said: <prior answer>
  Q<m> just established: <new context>

With Q<m> in mind, my recommendation flips to <new>: <reason>.

Your move:
  [re-open Q<n>]                          re-ask with the new context
  [keep both — accept inconsistency]      flag in plan.md as NEEDS CLARIFICATION
  [explain consistency]                   you clarify why no change needed
```

### Outcomes

| User choice | Effect |
|---|---|
| `re-open Qn` | Re-ask as **`Qn'`** (prime). Original Qn → `Status: superseded-by Qn'`. New Qn' → `Revisited-from: Qn`. |
| `keep both` | Both stay active in `decisions.md`. Inconsistency recorded as `[NEEDS CLARIFICATION]` in plan.md buffer. |
| `explain consistency` | User explains; explanation captured under `Reconciliation:` on the original Q. Both stay active. |

### Caps

- Max 2 revisits per question. If `Q3'` itself gets challenged (would be `Q3''`), surface both versions and ask the user to pick — don't keep iterating.
- Max 3 open revisit threads. Finish one before opening another.

### Context discipline

- Understanding model lives in `decisions.md` on disk, not in conversation.
- Re-read `decisions.md` (or relevant subset) when running the consistency pass — not the chat history.
- Superseded entries stay on disk but **are not re-loaded** into working context unless explicitly relevant.
- Design phase receives only `Status: active` entries. Superseded chains are flattened to one-line annotations.

---

## 6. Answer slots in `decisions.md`

Every question is written to `decisions.md` with explicit slot markers. The slot is the audit / recovery surface — the agent mirrors each answer into the matching `<!-- loom:answer-slot -->` region as the user picks it via `AskUserQuestion` (§4). The agent treats `AskUserQuestion` as the only primary answer surface; users are not expected to edit `decisions.md` by hand.

```markdown
## Q3 [Y/N]: Use TypeScript?
<!-- loom:question version=1 id=Q3 category=Y/N sub-phase=branching -->

- **Sub-phase:** branching
- **Depends on:** [Q1]

What's the issue:
The service ships in Node.js but the team hasn't decided on TypeScript vs.
plain JavaScript. The decision affects every file added in this iteration —
flipping later means a project-wide migration.

Current behavior / what's causing it:
The four adjacent microservices the team owns all use TypeScript with
strict mode and shared tsconfig.base.json. This service was scaffolded last
week from the JS-only template because no one had spec'd the language
stack yet.

Options:
  (YES) [M, Low]  Adopt TypeScript — strict typing throughout, half-day extra setup, matches adjacent services
  (NO)  [S, High] Stay on plain JavaScript — faster to scaffold, drifts from the four adjacent services

Recommendation: YES — adjacent services use TS, drift cost compounds
Why not the other: NO is faster today but the migration cost lands within the quarter
Status: awaiting-answer

### Resolution

<!-- loom:answer-slot start id=Q3 -->
*(awaiting user answer)*
<!-- loom:answer-slot end id=Q3 -->
```

After the user answers:

```markdown
- **Status:** answered

### Resolution

<!-- loom:answer-slot start id=Q3 -->
YES
<!-- loom:answer-slot end id=Q3 -->
```

### Slot rules

- Slot markers MUST be HTML comments so they survive markdown rendering.
- The `id=` attribute on `start` / `end` MUST match the question id.
- A question MUST NOT have content between `start` and `end` other than the answer (or the placeholder `*(awaiting user answer)*`).
- Side requirements (`SR-N`) and `[NEEDS CLARIFICATION]` items live in their own sections at the bottom of `decisions.md` — they do NOT use answer slots.
- Status values: `awaiting-answer`, `answered`, `deferred`, `superseded-by Q<n'>`, `obsolete`, `active` (after revisit).

### Parser invariant

`decisions.md` MUST be parseable by a script that:

1. Splits on `## Q<n>` headers.
2. Reads `<!-- loom:question -->` and `<!-- loom:answer-slot -->` markers.
3. Extracts answer text between `start` and `end` markers.
4. Reads `Status:` to determine which questions to include in the active set.

Design phase reads only `Status: active` and `Status: answered` entries (and chains flattened to `superseded-by` leaves).

---

## 7. Hard caps — when to stop grilling

| Trigger | Action |
|---|---|
| Ambiguity stable across 2 consecutive answers | Return artifacts; orchestrator surfaces the rerun-or-continue decision. |
| User says `stop`, `enough`, `let's move on`, `go` | Write current state, return artifacts. |
| Ambiguity still surfacing after many turns | RETURN `STATUS: needs_more_grilling` to the orchestrator; let the user decide whether to extend. |
| User clicks `Stop` before answering N≥3 questions in a row | Force-end Spec: write the resolved Qs to decisions.md, capture the unanswered ones in the "Deferred clarifications" section (these become `[NEEDS CLARIFICATION]` markers when plan.md is generated), return artifacts. |

---

## 8. Required output of a grilling session

When the Spec phase agent returns, it MUST have written:

1. `spec.md` — what the user is building, why, scope, out of scope, **user stories with EARS acceptance criteria** (per [`stories.md`](stories.md)), constraints, open ambiguity.
2. `decisions.md` — every Q with its slot, status, recommendation, resolution. Side requirements section. Deferred clarifications section. Parseable by the rules in §6.

Stories are distilled from grilling answers + seed at the end of the loop (Work Loop step 10 in [`phase.md`](../phase.md)). They are NOT user-answered questions; they are agent-produced outputs. Universal acceptance conditions go under `spec.md` `## Constraints`, not Stories.

These two writes are non-negotiable. They are the contract Design inherits.

---

## Stop Rules (summary)

1. Ambiguity stable across 2 consecutive answers.
2. User indicates enough context.
3. Ambiguity still grows after many turns.
4. Repeated unanswered questions.

## Revisit Rules (summary)

1. New answer flips a prior recommendation.
2. Prior trade-off no longer applies.
3. Prior assumption contradicted.
4. Prior scope decision obsolete.
