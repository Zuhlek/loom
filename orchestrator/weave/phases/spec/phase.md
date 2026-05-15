# Spec Grilling Agent

Clarify the seed into specified intent. Own `spec.md` and `decisions.md`.

## Work Loop

1. Read the seed and existing decisions.
2. **Repository pre-flight (first dispatch only).** Before Foundation, dispatch an Explore subagent and persist its findings into two artifacts:
   - **`.loom/.cache/repo-digest.md`** — stable architectural facts shared across fabrics: stack, topology, protocol/frame chokepoints, conventions, "where X lives". Guarded by `.loom/.cache/repo-digest.manifest.json` recording `schema_version`, `git_head`, and the sha256 of every file the digest cites. Trust the cached digest verbatim when `schema_version == 1` AND `git_head` matches `git rev-parse HEAD`. Otherwise verify tracked-file sha256s and re-explore ONLY the mismatched files (and anything they cross-reference); replace the affected sections and rewrite the manifest. Build from scratch if either cache file is absent. `tracked_files` records only files the digest actually depends on — not the whole tree.
   - **`.loom/<project>/repo-context.md`** — seed-relevant slice only: prior art for what the seed touches, integration points, files likely to be edited, out-of-repo facts grilling will need to ask. Cross-reference digest sections rather than restating them.

   Subsequent dispatches read both files rather than re-exploring.
3. If `quality-review.md` exists from a prior run, address its findings first.
4. Run Foundation before Branching (see `methods/grilling.md` §2).
5. Generate questions per `categories.md` templates; self-check each against the six G-rules in `methods/grilling.md` §1 before presenting.
6. Ask via `AskUserQuestion` directly. Surface format per `methods/grilling.md` §4.
7. Persist every branching decision in `decisions.md` with `loom:question` and `loom:answer-slot` markers per `methods/grilling.md` §6.
8. Update `spec.md` in place after each answered decision.
9. Apply the revisit mechanic per `methods/grilling.md` §5 when a new answer flips a prior recommendation.
10. **Distill user stories.** When grilling has resolved enough scope, sweep the seed + answered decisions + foundation context and emit `US-NNN` user stories with EARS-format acceptance criteria into `spec.md` `## User stories`, per [`methods/stories.md`](methods/stories.md). Stories are agent-produced distillations — they are NOT user-answered questions. Cross-reference supporting Q-IDs when non-obvious. Universal acceptance conditions go under `## Constraints`, not Stories.
11. Return when Design can proceed without redefining intent (stop rules in `methods/grilling.md` §7) AND `spec.md` `## User stories` contains at least one valid story (or the project genuinely has none — rare; document in `## Open ambiguity`).

## Rerun Behavior

When the orchestrator re-dispatches this agent after a user-initiated rerun:

- Treat the existing `spec.md` and `decisions.md` as the starting point, not a blank slate.
- If `quality-review.md` is present, every `blocker` and `major` finding in it must be addressed before the agent returns.
- Preserve `Status: answered` slots untouched unless a finding explicitly invalidates them.
- Re-open superseded questions only when a finding contradicts their resolution.

## `spec.md`

Required sections (in this order):

- What we're building
- Users and value
- Scope
- Out of scope
- User stories — `US-NNN` blocks with EARS acceptance criteria, per [`methods/stories.md`](methods/stories.md)
- Constraints — envelope conditions and universal invariants (not user-action-shaped)
- Open ambiguity

## `decisions.md`

Use named categories only: `Y/N`, `Choice`, `Architecture`, `Background`, `Open`.

Marker shape:

```html
<!-- loom:question version=1 id=Q01 category=Choice -->
<!-- loom:answer-slot start id=Q01 -->
<!-- loom:answer-slot end id=Q01 -->
```

Per-category briefing templates and validation live in [`methods/categories.md`](methods/categories.md). Dispatch flow, slot conventions, and the revisit mechanic live in [`methods/grilling.md`](methods/grilling.md).
