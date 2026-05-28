# User Stories + EARS Acceptance Criteria

Spec-phase distillation discipline. The Spec agent writes user stories with EARS-format acceptance criteria into `spec.md` under `## User stories`. Stories are produced by the agent — they are NOT user-answered questions. The agent distills them from the seed plus grilling answers.

This file specifies the story shape, the EARS notation patterns, the markers, IDs, and how stories relate to decisions.

---

## 1. Why stories + EARS

User stories make user-facing intent **named and traceable**. EARS-format acceptance criteria make each story **testable** by structured pattern rather than free prose.

After Spec, downstream phases consume stories by ID:

- **Design** reads stories (read-only) and produces structure that satisfies them. Design does NOT restate stories as flows; that would duplicate Spec.
- **Plan** assigns one or more tasks per story (`tasks/T-NNN.md` references the `US-NNN` IDs it satisfies).
- **Build** derives test scaffolds from each EARS AC clause.
- **Review** audits story-vs-implementation by walking each `SHALL` clause.

---

## 2. Story format

Every story has the same shape:

```markdown
### US-001: <short title — 5-10 words>
<!-- loom:story id=US-001 status=active -->

**Story:** As a <role>, I want <action>, so that <value>.

**Acceptance criteria:**
1. <EARS clause>
2. <EARS clause>
3. <EARS clause>

<!-- loom:story-end id=US-001 -->
```

Required fields:

| Field | Shape |
| --- | --- |
| Title (`### US-NNN: <title>`) | Title-case, 5–10 words, names the user-observable behaviour |
| Marker (`<!-- loom:story id=US-NNN status=... -->`) | HTML comment; survives markdown rendering; parseable |
| Story body (`**Story:** As a ..., I want ..., so that ...`) | Single sentence, role/action/value triple |
| Acceptance criteria | 1–5 EARS clauses (see §3); numbered list |
| End marker (`<!-- loom:story-end id=US-NNN -->`) | Matches the opening `id=` |

A story without at least one acceptance criterion is **malformed** — the agent regenerates it before writing.

---

## 3. EARS acceptance-criteria patterns

Each AC is exactly one EARS clause. EARS is "Easy Approach to Requirements Syntax" (Alistair Mavin). The five patterns are mutually exclusive — the agent picks one per clause:

| Pattern | Keyword | Shape | Use when |
| --- | --- | --- | --- |
| **Ubiquitous** | (none) | `The system shall <response>.` | Always true; no trigger or precondition. |
| **State-driven** | `While` | `While <state>, the system shall <response>.` | The behaviour applies only in a specific state. |
| **Event-driven** | `When` | `When <trigger>, the system shall <response>.` | The behaviour fires in response to a specific event. |
| **Optional feature** | `Where` | `Where <feature is included>, the system shall <response>.` | The behaviour applies only when an optional feature is present. |
| **Unwanted behaviour** | `If`...`then` | `If <trigger>, then the system shall <response>.` | The behaviour is the system's response to an undesired event. |

### Examples

```
1. WHEN the user clicks Start, the system SHALL begin counting down from 25:00.
2. WHILE the timer is running, the system SHALL update the visible mm:ss every second.
3. WHEN the work session reaches 00:00, the system SHALL play an audible beep.
4. IF the browser denies Notification permission, then the system SHALL fall back to flashing the title bar.
5. The system shall persist the cycle counter across page reloads.        (← ubiquitous, no keyword)
```

### Pattern selection rules

- Prefer **event-driven (`When`)** for user-action-triggered behaviour. Most stories have at least one `When` clause.
- Use **unwanted behaviour (`If ... then`)** for error / denial / failure paths. Always name the "unwanted" condition explicitly.
- Use **state-driven (`While`)** for continuous behaviour during a mode (e.g. "while running", "while paused").
- Use **optional feature (`Where`)** for behaviour conditional on a feature being present. Use sparingly; for most projects there's no optional feature surface.
- Use **ubiquitous** (no keyword) only for invariants that hold regardless of trigger or state. The clause starts with `The system shall ...`.

### Required keyword discipline

Each AC clause begins with one of: `When`, `While`, `If`, `Where`, or `The system shall` (ubiquitous). Free-prose ACs that don't open with one of these are **malformed** — the agent re-formulates before writing.

### `SHALL` is mandatory

Every EARS clause uses `SHALL` (uppercase) for the system response. This is the EARS canonical verb — it makes each clause greppable and signals "this is a normative requirement, not a description."

---

## 4. Story IDs

- Format: `US-NNN` where `NNN` is a zero-padded three-digit number (`US-001`, `US-002`, …, `US-099`, `US-100`).
- Contiguous and stable per project. IDs are assigned in the order stories are first written; gaps from superseded stories are kept (do not renumber).
- An ID, once assigned, is **never reused** — a superseded story keeps its ID and gets a new status marker.

---

## 5. Story status

The `status` attribute on the `<!-- loom:story -->` marker tracks lifecycle:

| Status | Meaning |
| --- | --- |
| `active` | Current; downstream phases consume this story. (Default.) |
| `superseded` | A later story / grilling answer made this obsolete. Body kept on disk for audit. Mark with `superseded-by US-NNN` in the same comment if a replacement exists. |
| `deferred` | Scope-cut to a later iteration. Downstream phases ignore. |
| `answered` | Used during grilling when a story has been confirmed by the user against a recommendation. Equivalent to `active` post-confirmation; the status exists so the Pre-Build Quality Check agent (at the Plan→Build gate) can distinguish agent-drafted vs user-confirmed stories when auditing the Spec layer. |

Downstream phases (Design / Plan / Build) read **only** `Status: active` and `Status: answered` stories. Superseded / deferred stories are visible only in audit.

---

## 6. Universal acceptance — not a story

Some acceptance conditions are universal envelope conditions, not user-action-shaped:

- "All form inputs are validated before submission."
- "All API responses include a request ID."
- "No external network calls at runtime."

These do NOT become stories — there's no user role / action / value triple. They live under `spec.md` `## Constraints` instead. A constraint is a Spec-wide invariant; a story is a user-shaped behaviour.

If the agent finds itself writing a story whose body is *"As a user, I want every <X> to be <Y>"* without a concrete user action, demote it to a Constraint.

---

## 7. Story distillation in the work loop

Stories are distilled **at the end** of grilling, not asked as questions. Flow:

1. Foundation grilling — gather context (Background, Open questions).
2. Branching grilling — resolve scope and decision points (Y/N, Choice, Architecture, Background).
3. **Story distillation** — sweep the seed + answered decisions + foundation context; emit one or more `US-NNN` stories with EARS AC into `spec.md` `## User stories`. Match each story against its supporting Q-IDs in `decisions.md` if non-obvious.
4. Validate — every story has ≥1 EARS AC; every AC opens with a valid keyword; every universal acceptance condition lives under Constraints not Stories.

If a story would surface a decision the agent cannot make confidently (e.g. role identity unclear, value ambiguous), the agent asks a normal grilling question first (typically `Open` category), then distils after the answer.

---

## 8. Relating stories to decisions

When a decision in `decisions.md` directly answers "should this story exist?", reference the Q-ID in the story body:

```markdown
### US-003: Cycle counter persists across reloads
<!-- loom:story id=US-003 status=active -->

**Story:** As a user tracking my focus sessions, I want the cycle count
to survive page reloads, so that I don't lose progress when I refresh
the tab.

**Supporting decisions:** Q-Y4 (reload behaviour)

**Acceptance criteria:**
1. WHEN the user reloads the page, the system SHALL restore the cycle count from `localStorage`.
2. IF `localStorage` is unavailable or corrupted, then the system SHALL default the cycle count to zero.

<!-- loom:story-end id=US-003 -->
```

`Supporting decisions:` is optional — include it when a story exists *because of* a specific decision, omit it for stories that are obvious from the seed.

---

## 9. Spec-layer assertions audited by the Pre-Build Quality Check

The Pre-Build Quality Check agent (`phases/plan/quality-check.md`, opt-in at the Plan→Build gate) checks the Spec layer of the pre-Build artifact set against:

- Every story has a `loom:story` opening marker, a `loom:story-end` matching marker with the same `id`, and a `status` attribute on the opener.
- Every story has exactly one role/action/value `**Story:**` line.
- Every story has ≥1 acceptance criterion.
- Every AC opens with a valid EARS keyword (`When`, `While`, `If`, `Where`) or starts with `The system shall` (ubiquitous).
- Every `If` is paired with `then`.
- Every story ID is unique, zero-padded three-digit, and not gapped beyond contiguous assignment minus superseded.
- No story body matches the "universal acceptance" anti-pattern (story without a concrete user action) — those belong under Constraints.

---

## 10. Parser invariant

`spec.md`'s `## User stories` section MUST be parseable by a script that:

1. Splits on `### US-NNN:` headers under `## User stories`.
2. Reads `<!-- loom:story id=... status=... -->` and `<!-- loom:story-end id=... -->` markers.
3. Extracts the `**Story:**` line and the `**Acceptance criteria:**` numbered list.
4. Reads `status` to determine which stories to include in the active set.

Design / Plan / Build / Review consume the parsed set; `superseded` / `deferred` stories are visible only to the Pre-Build Quality Check agent and to auditors.
