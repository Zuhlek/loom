# Question Categories

Five categories. Pick one per question by inspecting what the question requires of the user. Each category has a strict template — the `validate-subagent-output` hook validates required fields before a question is presented.

Bias toward cheaper categories. **Y/N** is preferred when it fits; demote richer categories when possible.

Every question — regardless of category — also wears a **Briefing block** wrapper. The briefing is the difference between "the user has to ask `[explain more]` before they can answer" and "the user reads the question once and answers." It is mandatory.

---

## Briefing block (required on every question)

Every question opens with these three labelled sections, in this order, before the category-specific options. The briefing is part of the question text written into the `## Q<n>` block in `decisions.md` — NOT a follow-up the user has to request.

**Plain-text discipline.** Briefing prose is read in the UI's plain-text panes and in raw markdown. Use plain-text section labels with a trailing colon, indented option lines, and an em-dash to separate option name from implication inside the briefing. The full options table (with Effort / Risk / Result columns) lives in the structured `**Options at a glance**` markdown table that the parser reads — keep `**bold**` and tables out of the prose briefing body.

```
What's the issue:
<30–80 words, plain language, no internal jargon. Reference file:line if grounded in code.>

Current behavior / what's causing it:
<varies per category — see below>

Options:
  (A) [<Effort>, <Risk>] <option name> — <≤120 chars one-line outcome>
  (B) [<Effort>, <Risk>] <option name> — <≤120 chars one-line outcome>

  Effort = S | M | L     (small / medium / large)
  Risk   = Low | Med | High
```

(For **Y/N**: lines are `(YES)` / `(NO)`. For **Open**: replace the option list with a `Suggested direction` paragraph — one paragraph proposing the agent's direction.)

After the briefing block, two final lines:

```
Recommendation: <option-letter or YES/NO> — <one-line reason ≥6 words>
Why not the others: <one-line trade-off the user might want to push back on>
```

The recommendation goes LAST (after the user has read the issue, cause, and options) so the user is not pre-anchored to the agent's pick before understanding the choice.

### Per-category specifics for "Current behavior / what's causing it"

| Category | Length | Extra requirement |
|---|---|---|
| **Y/N**          | 30–80 words   | — |
| **Choice**       | 30–80 words   | — |
| **Architecture** | 30–120 words  | **Diagram required** (mermaid or 5-line ASCII) when ≥3 components are referenced. The diagram is part of this section, not separate. |
| **Background**   | 50–200 words  | The "current behavior" IS the domain background — concept(s) needed to answer, with a reference to prior art if useful. |
| **Open**         | 30–80 words   | — |

---

## Category — Y/N

**When to use:** the decision has exactly two viable paths, and each path's consequence fits in one short line.

**Template:**

```
Q<n> [Y/N]: <one-sentence question>

<briefing block per the spec above — options list has YES / NO rows>

**Recommendation:** YES|NO — <one-line reason ≥6 words>
**Why not the other:** <one-line trade-off>
```

**Required fields:** `id`, `question_text`, briefing block (`what_is_the_issue`, `current_behavior`, `options_list`), `recommendation`, `recommendation_reason`, `why_not_the_other`.

**Anti-example (lazy, schema violation):**

```
Q3 [Y/N]: Use TypeScript?
  Recommendation: yes
```

— missing briefing block entirely, recommendation reason too short.

---

## Category — Choice

**When to use:** 3–5 distinct viable options, no architecture sketch needed to pick.

**Template:**

```
Q<n> [Choice]: <one-sentence question>

<briefing block per the spec above — options list has 3–5 rows, one per option>

**Recommendation:** (X) — <one-line reason ≥6 words>
**Why not the others:** <one-line trade-off>
```

**Required fields:** `id`, `question_text`, briefing block (`what_is_the_issue`, `current_behavior`, `options_list` with 3 ≤ count ≤ 5), `recommendation`, `recommendation_reason`, `why_not_the_others`.

---

## Category — Architecture

**When to use:** the question only makes sense after a brief sketch of the relevant structure.

**Template:**

```
Q<n> [Architecture]: <one-sentence question>

<briefing block per the spec above — `current_behavior` is the architecture
sketch (30–120 words) AND must include a mermaid or 5-line ASCII diagram when
≥3 components are referenced. Options list has 2–5 rows.>

**Recommendation:** (X) — <one-line reason ≥6 words>
**Why not the others:** <one-line trade-off>
```

**Required fields:** `id`, `question_text`, briefing block (`what_is_the_issue`, `current_behavior` = arch sketch + diagram, `options_list` with 2 ≤ count ≤ 5), `recommendation`, `recommendation_reason`, `why_not_the_others`.

**Note:** the diagram is not optional. Architecture is *defined* by the user needing a structural sketch — if the question would read fine without one, it's actually Y/N or Choice and should be demoted.

---

## Category — Background

**When to use:** the user may not know the concept(s) needed to answer. Background is non-trivial (more than a sentence).

**Template:**

```
Q<n> [Background]: <one-sentence question>

<briefing block per the spec above — `current_behavior` is the domain
background (50–200 words), referencing prior art or authoritative sources
if useful. Options list has 2–5 rows.>

**Recommendation:** (X) — <one-line reason ≥6 words>
**Why not the others:** <one-line trade-off the user might want to push back on>
```

**Required fields:** `id`, `question_text`, briefing block (`what_is_the_issue`, `current_behavior` = domain background, `options_list` with 2 ≤ count ≤ 5), `recommendation`, `recommendation_reason`, `why_not_the_others`.

The `why_not_the_others` field is the structural anti-laziness device for deep questions — the agent must name the strongest counter-argument so the user can push back if it doesn't apply.

---

## Category — Open

**When to use:** answer space isn't enumerable. Naming, scope phrasing, value judgments. Use sparingly.

**Template:**

```
Q<n> [Open]: <question>

<briefing block per the spec above — replace the "Options" list
with a "Suggested direction" paragraph that explains the agent's proposal.>

**Recommendation:** <agent's proposal> — <one-line reason ≥6 words>
**Why not other directions:** <one-line trade-off>
```

**Required fields:** `id`, `question_text`, briefing block (`what_is_the_issue`, `current_behavior`, `suggested_direction`), `recommendation`, `recommendation_reason`, `why_not_other_directions`.

---

## Triage — picking a category

Walk in order of preference (cheapest first):

1. Can I answer this myself in < 2 min via an Explore subagent? → dispatch Explore, don't ask.
2. Would either answer cause rework? (rule G1 in `grilling.md`) → if no, skip the question entirely.
3. Exactly two viable options, implications fit in one line each? → **Y/N**.
4. 3–5 options, pure list (no architecture needed)? → **Choice**.
5. Needs architecture sketch to make sense? → **Architecture**.
6. Needs domain / background knowledge? → **Background**.
7. Free-text answer? → **Open**.

**Demotion rule:** a Background question that can be reframed as a Y/N becomes a better question. Always try to demote.

---

## Validation summary

```yaml
required_fields_per_category:
  # All categories share the briefing block:
  briefing_block: [what_is_the_issue, current_behavior]
  # Plus the category-specific shape:
  Y/N:          [id, question_text, briefing_block, options_list (YES/NO rows), recommendation, recommendation_reason, why_not_the_other]
  Choice:       [id, question_text, briefing_block, options_list (3..5 rows), recommendation, recommendation_reason, why_not_the_others]
  Architecture: [id, question_text, briefing_block, diagram (when ≥3 components), options_list (2..5 rows), recommendation, recommendation_reason, why_not_the_others]
  Background:   [id, question_text, briefing_block, options_list (2..5 rows), recommendation, recommendation_reason, why_not_the_others]
  Open:         [id, question_text, briefing_block (with suggested_direction in place of options_list), recommendation, recommendation_reason, why_not_other_directions]

word_minimums:
  recommendation_reason: 6
  what_is_the_issue: 30
  current_behavior_yn: 30
  current_behavior_choice: 30
  current_behavior_architecture: 30   # plus required diagram when ≥3 components
  current_behavior_background: 50     # this IS the domain background
  current_behavior_open: 30

word_maximums:
  what_is_the_issue: 80
  current_behavior_yn: 80
  current_behavior_choice: 80
  current_behavior_architecture: 120
  current_behavior_background: 200
  current_behavior_open: 80
  options_list_cell: 80   # per-cell character cap, not word cap

option_counts:
  Choice: 3..5
  Architecture: 2..5
  Background: 2..5
```

A question that fails validation must be regenerated before it is presented to the user. The user only ever sees well-formed questions — including a complete briefing block.
