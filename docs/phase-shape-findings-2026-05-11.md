# Phase shape findings — 2026-05-11

Triggered by the `phase-validators` `/weave` run (transcript in `/Users/tristankindle/dev/loom/fdsaf.txt`). Three concerns reported:

1. The Idea / Design distinction is not understandable to the user.
2. The Design phase is not posing "design" questions at all.
3. The validator is not found.

## What I found (independent of the concerns)

| Phase | `agent.md` | `methods/` | `validator.md` | Grilling discipline | Question taxonomy |
| --- | --- | --- | --- | --- | --- |
| idea | 98 lines | grilling.md (285) + categories.md (221) | yes | yes | 5 categories (Y/N, Choice, Architecture, Background, Open) |
| design | 68 lines | absent | **no** | one bullet: *"Ask direct questions only for structure-critical ambiguity"* | none |
| plan | similar to design | absent | **no** | none | none |
| build | shape-specific | task-builder / smoke-test / mutation-test | **no** | n/a (work executes, doesn't grill) | n/a |
| review | similar to design | absent | **no** | n/a | n/a |

Sanity checks:
- Skill symlink intact: `~/.claude/skills/weave` → `~/dev/loom/orchestrator/weave`. The `phases/idea/validator.md` path resolves. Path-resolution is not the bug.
- `design/contract.md:58` reads literally `## Validator\n\nNone in this phase.` That sentence is the entire reason "validator not found" can happen for Design.
- Transcript confirms: Design agent dispatched, ran in one pass, wrote 454-line `design.md`, asked zero `AskUserQuestion`s, returned `complete`. That's faithful to the current under-specified spec. The agent did exactly what it was told.

The three concerns collapse into two root causes (one structural, one cosmetic):
- **Root cause A** — phases after Idea are under-specified relative to Idea. The agent has nothing to do *except* guess at structure.
- **Root cause B** — the gate prompts don't tell the user what the next phase is FOR, so the difference between Idea and Design is invisible until artifacts are diffed by hand.

The third concern (validator not found) is downstream of Root Cause A: the validator files for design / plan / build / review don't exist yet. The in-flight `phase-validators` project is the work that addresses it.

---

## F-1 — Design phase has no grilling infrastructure

### Issue
`design/agent.md` step 3 of the Work Loop says *"Ask direct questions only for structure-critical ambiguity"* and stops. There is no `phases/design/methods/grilling.md`, no question taxonomy, no slot/answer mechanic, no revisit logic, no stop rules. Compare Idea, which has all of those (`phases/idea/methods/grilling.md` is 285 lines).

Effect in practice (from the phase-validators transcript): the Design agent fired once, wrote 454 lines of `design.md`, and returned `complete` without any `AskUserQuestion` call. The user sees "Idea grilled me with 6 questions, then Design wrote a wall of text and asked nothing" — and reasonably concludes Design isn't doing its job.

The memory note for the framework direction is explicit: *Design's dominant interaction mode is grill + preview*. Today it does neither.

Same diagnosis applies to **Plan** phase (`plan/agent.md` has no `methods/` either). Per the framework direction Plan should run *grill + variant-choose*. Today it doesn't grill.

### Options
- **(a) Mirror Idea's structure into Design and Plan.** Create `phases/design/methods/{grilling.md,categories.md}` and `phases/plan/methods/{grilling.md,categories.md}` modeled on Idea's, with design-specific and plan-specific question taxonomies. Design's categories would be structural (`Component-split`, `Interface-style`, `Data-shape`, `State-location`, `Layering`, `Mockup`); Plan's would be planning (`Slicing`, `Sequencing`, `Variant-choose`, `Verification-environment`, `Scope-cut`). Each phase carries its own copy of the discipline, keeping methods phase-owned (matches the existing layout).
- **(b) Extract a shared grilling skeleton.** Move the phase-agnostic mechanics (G-rules, slot/answer parser, revisit, stop caps, AskUserQuestion dispatch loop) into something like `orchestrator/weave/lib/grilling-core.md`, and have each phase ship a small `methods/categories.md` with just its category set. Less duplication, but introduces a cross-phase shared file (which the framework has avoided so far).
- **(c) Inline the discipline.** Expand each `<phase>/agent.md` to ~250 lines containing grilling rules, taxonomy, and stop conditions inline, without a `methods/` directory. Keeps the one-file-per-phase shape but duplicates G-rule wording.
- **(d) Leave as-is and accept that Design/Plan don't grill.** Treat them as one-shot structuring/planning passes. This contradicts your stated framework direction (memory: "interaction inside phases, not just at gates") so I'd advise against it.

### Recommendation
**(a)** — phase-local discipline files, copy-then-adapt from Idea. Reasons:
- Matches the existing layout (every phase already owns its own folder).
- The category sets *will* diverge per phase (Idea asks "what + why", Design asks "how — components/data/interfaces", Plan asks "slice + sequence + variants"); a shared skeleton would have to model that divergence anyway.
- Easier to evolve one phase's grilling without coupling the others.
- Cost: ~2 files per phase × 2 phases (Design + Plan) = 4 new files modeled on existing ones. No new framework concepts.

If you later see content drift that wants to be deduplicated, that's a clean follow-up — but **(b)** as a first move premature.

Note that this is **not** an easy-win cleanup — it's a real piece of authoring work (taxonomies for two phases). The mechanical discipline (G-rules, slot mechanic, revisit, stop caps) can be copied; the per-phase **categories** need real thought from someone who knows the framework's design intent.

### Your answer
a


---

## F-2 — Idea vs Design purpose is invisible at the user surface

### Issue
The orchestrator's HITL gate prompts read like:

```
Phase design returned. <one-line summary of produced artifacts>.

  Continue           accept the artifacts; advance to the next phase
  Run quality check  dispatch the Quality Check subagent ...
  Rerun phase        re-dispatch <phase> with prior artifacts ...
```

(From [orchestrator/weave/SKILL.md](../orchestrator/weave/SKILL.md), Rerun-or-Continue Decision section.)

Nothing in the prompt tells the user what `design` is FOR vs what `idea` was for. From the user's seat: Idea grilled, produced docs; Design wrote more docs; the difference isn't named. A user who hasn't read the agent.md specs can't tell whether Design failed to ask questions because it didn't have anything to ask, or because the framework doesn't expect it to.

This is a cosmetic issue with a real consequence: it makes F-1 (no Design grilling) look like a bug to the user even when the agent is doing exactly what its spec says.

### Options
- **(a) Add a per-phase one-line purpose tagline to the gate prompt.** E.g. *"Phase design returned (purpose: convert specified intent into solution structure — components, interfaces, data shapes)."* The tagline lives in each `phases/<phase>/agent.md` as a `Purpose:` frontmatter or top-of-file line, and the orchestrator reads it when composing the AskUserQuestion. One-line cost per phase; immediate user-surface clarity gain.
- **(b) Lead the phase summary with the phase's contract one-liner from its `agent.md`.** Same idea as (a) but uses the existing first sentence of each agent.md (e.g. Design's *"Convert specified intent into solution structure"*) instead of a new field. Even cheaper — no new metadata, the orchestrator just reads the agent.md head.
- **(c) Add a `## Next phase preview` section to the gate prompt** so the user sees "you're about to start Design which will <do X>" *before* accepting Continue. More informative; longer prompts; possibly noisy if the user already knows the framework.
- **(d) Do nothing; expect users to read the framework docs.** Status quo; rejects the concern.

### Recommendation
**(b)** — re-use the first sentence of each agent.md as the user-facing tagline. Zero new metadata, zero file edits beyond the orchestrator SKILL.md prompt template, and the agent.md first sentences are already short and accurate (e.g. *"Convert specified intent into solution structure"*, *"Convert solution structure into an executable work graph"*). The user sees:

```
Phase design returned (Convert specified intent into solution structure).
<one-line summary of produced artifacts>.

  Continue            ...
  Run quality check   ...
  Rerun phase         ...
```

Cost: one edit to `SKILL.md`'s Rerun-or-Continue Decision template. Tiny.

If you want (a)'s explicit field instead — e.g. so phases can override the tagline without rewriting the agent.md opener — that's a small extension on top.

### Your answer
b


---

## F-3 — Validator coverage is uneven; "validator not found" is the design / plan / build / review case

### Issue
Only `phases/idea/validator.md` exists. The other four phase `contract.md` files (design / plan / build / review) say:

```
## Validator

None in this phase.
```

When the orchestrator runs the QC predicate (file-presence check we agreed on in F-5 of the prior testrun findings), the file is absent for design/plan/build/review → QC option isn't surfaced → user sees a 2-option gate instead of 3. From the user's perspective, "the validator is not found." Strictly accurate — there *is no* validator file.

This is exactly what the in-flight `phase-validators` project is meant to fix. Its `.loom/phase-validators/idea.md` already specifies three new validator files (design / plan / build), Review intentionally omitted per its Q02 grilling decision. The work is sized, scoped, and partially designed (idea + design phases already complete in that workspace).

### Options
- **(a) Let the phase-validators project finish.** It's the right venue: it's already scoped to add design/plan/build validators with the same shape as Idea's, the Idea and Design phases of that project have run, Plan is the next step. Finishing it closes this concern through the framework's own lifecycle (which is the point).
- **(b) Hand-author the three validator files now.** Bypass the framework, ship the files, mark phase-validators superseded. Faster but skips a real eat-your-own-dogfood opportunity.
- **(c) Add a stub `validator.md` to each missing phase with a note "not yet implemented".** Surfaces the QC option but the dispatched validator returns immediately. Worst of both: noisy gates, no real check. Not recommended.
- **(d) Remove the *"None in this phase"* line from the four `contract.md` files** so it doesn't look like a permanent design decision. Cosmetic but useful — the current phrasing reads as "this is intentional and final" rather than "not yet authored."

### Recommendation
**(a) + (d).** Drive the phase-validators project to completion (the work is partially done; Plan is the next dispatch). In parallel, soften the four `contract.md` "None in this phase" lines to something like:

```
## Validator

Not yet authored. See the in-flight `phase-validators` project.
```

That removes the "by design, never" reading and signals where the gap is being addressed. One-line edit × 4 files.

(b) is faster in elapsed time but loses the framework dog-fooding benefit, and you've already invested in the phase-validators run.

### Your answer
ignore, we check again if validators do exist. howeve,r if they dont exist, this should also be not referenced or mentione during gate


---

## Related observation (not a separate finding, just flagged)

Per the framework direction in your memory ([Loom phase interaction model](../../../.claude/projects/-Users-tristankindle-dev-loom/memory/loom_phase_interaction_model.md)):

> Each pre-Build phase has a dominant interaction mode:
> - Idea: grill (Q&A to extract latent intent)
> - Design: grill + preview (mockups, diagrams, side-by-side options for user critique)
> - Plan: grill + variant-choose (enumerate decision points, force user to pick)

Today only Idea's grill is implemented. F-1 closes the **grill** half for Design and Plan. The **preview** (mockups / side-by-side artifacts in Design) and **variant-choose** (forced picks for Plan) halves are bigger conceptual work and are out of scope for this round — flagging them so they don't get lost. If you want them queued as future findings, I can file them when this round closes.

---

# F-0 deep-dive — Spec / Design / Plan boundaries (industry research)

The user reported feeling that **Idea and Design overlap** and asked whether the phase split was a mistake, whether "Design" is the wrong terminology, whether Idea ≈ Spec, and whether Loom should adopt requirements-engineering-style documentation with explicit user stories. Research follows; recommendation at the bottom.

## What industry does (as of 2026)

The 2025–2026 wave of AI-assisted dev frameworks has converged on a **three-phase pre-execution model**. Two reference points are directly comparable to Loom:

### AWS Kiro — three files, named exactly

Kiro's spec workflow ([Kiro: Specs](https://kiro.dev/docs/specs/)) is:

| Phase | File | Content |
| --- | --- | --- |
| 1. Requirements | `requirements.md` | User stories in `As a <role>, I will <action/goal>` format, with EARS-notation acceptance criteria (`WHEN <trigger> THEN the system SHALL <response>`) |
| 2. Design | `design.md` | System architecture, components, data flow, error handling, testing strategy |
| 3. Tasks | `tasks.md` | Discrete executable items, dependency-ordered, traceable back to requirement numbers |

Notable: Kiro **does not have a "user flows" section in design.md**. Flows live as user stories in `requirements.md`. Design.md is pure structure.

### GitHub spec-kit — same three files, lean

[GitHub spec-kit](https://github.com/github/spec-kit) ships three slash commands used sequentially: `/specify` (creates `spec.md`), `/plan` (creates `plan.md`), `/tasks` (creates `tasks.md`). Plus a `constitution.md` for non-negotiable project rules (a pattern Loom already has). The Microsoft Developer blog ([Diving Into Spec-Driven Development With GitHub Spec Kit](https://developer.microsoft.com/blog/spec-driven-development-spec-kit)) notes a real friction point: *"I frequently got confused when to stay on the functional level, and when it was time to add technical details."* — which is exactly the Idea/Design boundary problem Loom is hitting.

### BMAD method — more phases, role-driven

[BMAD method](https://docs.bmad-method.org/) is finer-grained: **Analyst → PM → Architect → UX → Scrum Master → Dev → QA**. The PM produces a PRD (Product Requirements Document); the Scrum Master generates user stories after the architecture is settled. Different shape — heavier process, more agent specialization — but the same fundamental split between requirements (PRD) and architecture.

### IEEE 29148 (the requirements engineering standard)

[ISO/IEC/IEEE 29148:2018](https://standards.ieee.org/standard/29148-2018.html) is the canonical standard. Its position is clear: **user stories live in the stakeholder-needs and system-requirements processes, NOT in design**. The standard formally distinguishes:

- **Requirements engineering** — what the system must do (intent, stories, acceptance)
- **Design** — how it does it (architecture, components, interfaces)

Wikipedia's [Requirements engineering](https://en.wikipedia.org/wiki/Requirements_engineering) entry summarizes: *"most modeling activities are classified as design activities and not as requirements engineering activities."* Use cases and user stories belong to the requirements side.

### EARS notation (Easy Approach to Requirements Syntax)

[EARS by Alistair Mavin](https://alistairmavin.com/ears/) has emerged as the standard for testable acceptance criteria in spec-driven projects. Five patterns:

| Pattern | Syntax |
| --- | --- |
| Ubiquitous | The `<system>` shall `<response>` |
| State-driven | While `<precondition>`, the `<system>` shall `<response>` |
| Event-driven | When `<trigger>`, the `<system>` shall `<response>` |
| Optional feature | Where `<feature is included>`, the `<system>` shall `<response>` |
| Unwanted behavior | If `<trigger>`, then the `<system>` shall `<response>` |

Kiro adopted EARS directly. spec-kit has an [open request to integrate it](https://github.com/github/spec-kit/issues/1356). It pairs naturally with user stories — story states *what the user wants*, EARS states *what the system shall observably do*. Gherkin's Given/When/Then is the test-scenario sibling.

## What this means for Loom

Three findings that the research is unambiguous about:

1. **The 5-phase split is correct.** Nobody in the industry merges requirements and design — the cognitive separation (intent extraction vs. structural decisions) is real and Kiro/spec-kit/BMAD/IEEE all preserve it. Don't merge Idea into Design or vice versa.

2. **"Idea" is the wrong name.** Kiro calls it Requirements; spec-kit calls it Spec; BMAD calls it PRD; IEEE calls it Requirements. The agile / RE world has settled on **Spec** or **Requirements**. "Idea" suggests "rough thought" / "brainstorm", which is exactly the opposite of what the phase produces (a *specified intent* with acceptance criteria). The terminology mismatch is likely a contributor to "I struggle to see the difference from Design."

3. **The Idea/Design content overlap is a template defect, not a phase-model defect.** Both `idea.md` and `design.md` carry user-facing behavior content:
   - `idea.md` § "Expected behavior" is *de facto* user stories + acceptance criteria, written in prose.
   - `design.md` § "User flows" duplicates that content, restated as sequences.
   - Industry consensus is: user stories live in Spec only, Design is pure structure. Move stories home; the overlap evaporates.

The 2025–2026 framework convergence also points at three small additions Loom doesn't yet have:

- **EARS-format acceptance criteria** in user stories. Makes each story machine-checkable. Build can derive test scaffolds 1:1; Review can audit story-vs-implementation by structured pattern.
- **`constitution.md`** for non-negotiable project rules. Loom already has this (`.loom/<project>/constitution.md`) — already aligned.
- **Numbered, traceable requirements.** Kiro numbers each requirement (`Requirement 1`, `Requirement 2`…) and each task references which requirement it satisfies. Loom's `decisions.md` does this for *decisions* but not for *stories*.

## Options for F-0

### Option (a) — Rename Idea → Spec, restructure content; no phase merge

The minimum coherent change that addresses the user's three concerns:

- **Rename** `phases/idea/` → `phases/spec/`. Update `VALID_PHASES`, SKILL.md, contract.md, all internal cross-references. Workspaces with `Current phase: idea` migrate via a one-time rewrite.
- **Restructure `idea.md` → `spec.md`** as the canonical Spec document:
  - Keep: What we're building, Users and value, Scope, Out of scope, Constraints, Open ambiguity
  - **Add** a `## User stories` section with explicit `As a <role>, I want <action>, so that <value>` format
  - **Add** EARS-format acceptance criteria *inside each story*
  - **Remove** the separate `## Expected behavior` section (replaced by stories + AC)
  - **Remove** the standalone `## Acceptance boundaries` section (folded into per-story acceptance criteria)
- **Restructure `design.md`** to pure HOW:
  - Keep: System shape, Interfaces, Data model, State and error handling, Integration points, Constraints (technical), Alternatives considered, Open ambiguity
  - **Remove** the `## User flows` section (lives in spec.md as stories)
- **Plan** reads stories from `spec.md` directly — no more "extract user stories from Idea and Design" scraping; Plan's `task.md` references the story IDs that each task satisfies.

Cost: medium. ~10–15 file edits in the orchestrator, plus the in-flight `phase-validators` project would need its idea.md renamed and its design.md trimmed (small in absolute terms; it's already a docs-only project). The `principles.md` and `loom/types/*.md` references survive unchanged.

Aligns Loom with Kiro/spec-kit/BMAD/IEEE 29148 vocabulary.

### Option (b) — Rename Idea → Spec; keep current content shape

Pure renaming, no template restructure. The user's "I struggle to see the difference" complaint is partially addressed (clearer name) but the content overlap survives (`Expected behavior` in spec.md, `User flows` in design.md still both exist).

Cost: small. ~10 file edits, no template changes.

Useful as a first step if you want to test the renaming impact before committing to template changes.

### Option (c) — Restructure content, keep "Idea" name

The reverse of (b). Move stories home, cut User flows from design.md, but keep "Idea" as the phase name. Solves the content overlap but leaves the terminology mismatch.

Cost: small-medium. Template edits only.

Less satisfying because the name itself contributes to the confusion. If "Idea" stays, the section needs to *behave* like a Spec section despite the misleading label.

### Option (d) — Adopt full Kiro-style spec-driven model (heavier rewrite)

Match Kiro's three-file model exactly: `spec.md` (requirements + stories + EARS), `design.md` (structure), `tasks.md` (work units with traceability). Drop the Loom-specific `decisions.md` (decisions become trackable Q&A entries inside `spec.md` instead). Mandate EARS notation. Mandate per-task `satisfies: Req-N` traceability.

Cost: large. Touches every phase artifact contract, every agent.md, the orchestrator's RETURN schemas. Probably 6–12 hours of careful work.

Highest alignment with industry standard; biggest break from Loom's current shape; might be premature given the current state.

### Option (e) — Leave it alone; accept the overlap

Document the current Idea/Design split as "Loom's choice" and don't move toward industry alignment. Cheapest. Concedes the user's "I struggle to see the difference" concern.

## Recommendation

**(a)** — rename + restructure. Reasons:

- **Names matter for shared mental models.** "Spec" is what other frameworks, IEEE, and the industry literature use. New users won't be confused by an idiosyncratic name; old users (you) adapt fast because the content is the same.
- **The content move is small but high-impact.** Bringing stories home is a one-time template change with permanent clarity gain. The overlap that bothers you disappears mechanically — design.md *can't* duplicate flows if its template doesn't have a flows section.
- **EARS-format acceptance criteria are a real upgrade**, not just cosmetic. Each story becomes a testable contract; Build's test sketches map 1:1 to AC clauses; Review can audit story-vs-implementation by checking each `SHALL` clause.
- **Aligns with the in-flight `phase-validators` project** rather than disrupting it. That project is mid-flight; renaming the phase folder is a deterministic transform that doesn't change the project's intent.
- **It is NOT a phase merge.** Industry research is consistent: don't merge. The fix is naming and content boundaries, not structure.

If (a) feels too big right now, **(c) is the no-regret incremental** — fix the content overlap (move stories to idea.md, cut user flows from design.md) without renaming yet. That gets you 70% of the clarity gain at 30% of the cost; you can rename later if the content fix isn't enough.

(b) and (d) are dispreferred — (b) is half-measure (renames without solving the content problem); (d) is a bigger commitment than the evidence warrants right now.

### Implementation note for whichever option you pick

If renaming, do it as **one atomic commit**: pipeline-parser's `VALID_PHASES`, the directory rename, every reference in SKILL.md / contract.md / agent.md files, plus a one-time migration helper for existing workspaces (search `Current phase: idea` → `Current phase: spec`, plus directory `phases/idea/` → `phases/spec/`). Mixed-state workspaces are confusing to debug.

If restructuring content only, the four files to touch are: `phases/idea/artifact.md`, `phases/design/artifact.md`, `phases/idea/agent.md`, `phases/design/agent.md`. The agent specs need to reflect the new section lists in their RETURN-relevant content.

### Your answer
<!-- fill in -->


---

## Research sources

- [Kiro: Specs](https://kiro.dev/docs/specs/) — three-phase spec workflow
- [Kiro for AI-assisted spec-driven development (hedrange.com)](https://hedrange.com/2025/08/11/how-to-use-kiro-for-ai-assisted-spec-driven-development/) — concrete `requirements.md` + EARS examples
- [Understanding Spec-Driven Development: Kiro, spec-kit, and Tessl (Martin Fowler)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) — comparative artifact analysis
- [GitHub spec-kit](https://github.com/github/spec-kit) — Microsoft's open SDD toolkit
- [Diving Into Spec-Driven Development With GitHub Spec Kit (Microsoft Developer)](https://developer.microsoft.com/blog/spec-driven-development-spec-kit) — Spec Kit walkthrough; notes requirements-vs-design boundary friction
- [Specification-driven development (Wikipedia)](https://en.wikipedia.org/wiki/Spec-driven_development)
- [Requirements engineering (Wikipedia)](https://en.wikipedia.org/wiki/Requirements_engineering) — stories belong to requirements, not design
- [ISO/IEC/IEEE 29148:2018](https://standards.ieee.org/standard/29148-2018.html) — canonical requirements engineering standard
- [BMAD Method](https://docs.bmad-method.org/) and [BMAD-METHOD GitHub](https://github.com/bmad-code-org/BMAD-METHOD) — heavier role-based framework
- [Applied BMAD (Benny's Mind Hack)](https://bennycheung.github.io/bmad-reclaiming-control-in-ai-dev) — BMAD analysis
- [EARS notation (Alistair Mavin)](https://alistairmavin.com/ears/) — canonical EARS guide
- [Adopting EARS Notation (Jama)](https://www.jamasoftware.com/requirements-management-guide/writing-requirements/adopting-the-ears-notation-to-improve-requirements-engineering/)
- [Given When Then (Martin Fowler)](https://martinfowler.com/bliki/GivenWhenThen.html) — Gherkin/BDD reference, complement to EARS
