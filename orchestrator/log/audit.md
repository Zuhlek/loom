# Audit Log

## 2026-05-11 - loom-ui-phase-update - whitelist-pair-coupling-invariant

The change required updating two whitelists in lock-step: client
`KNOWN_ARTIFACTS` (`loom-view-live.tsx`) and server `ARTIFACT_FILES`
(`loom.ts`). The design.md doc made the invariant explicit ("ARTIFACT_FILES
must be a superset of KNOWN_ARTIFACTS"), and Build landed both edits in
one phase per Q2=B. This worked, but it's a textbook drift trap: a
future change that adds one artifact name to only one side will appear
to work in the short run (the file shows in the tree, the click does
nothing) and reads as a UI bug, not a missing whitelist entry. Two
plausible future moves:
- **Document the invariant** in a contract / lint rule (cheap, but
  relies on people reading it).
- **Single source of truth** — promote the list to a shared `@loom/...`
  constants module imported by both server and client. This is a real
  refactor with package-graph cost but eliminates the drift class.
The current change set didn't need to act on this; flagging it for
`/tune` curation as a candidate follow-up.

## 2026-05-11 - loom-ui-phase-update - single-layer-T-003-justification

T-003 ("server ARTIFACT_FILES whitelist") was a single-layer task —
ui-server only, no client-side companion in the same task. The Plan
contract requires that single-layer tasks carry an explicit
justification. T-003's spec included one: *"Single-layer (server-only)
justified: this is the one-line whitelist constant that gates disk
reads; per Q2=B the boundary was explicitly relaxed for this constant
only."* That justification ties back to the Idea-phase branching
decision and is verifiable at audit time — exactly the shape the
contract intends. Proof that the "single-layer requires justification"
rule from the Plan contract works in practice: the justification was
present, was specific, was tied to a decision artifact, and made the
audit trivial.

## 2026-05-11 - loom-ui-phase-update - first-attempt-green-on-mechanical-changes

All four tasks landed green on first attempt with zero retries. The
factors that made this possible:
- design.md included exact before/after snippets for every non-trivial
  edit (the `phaseStatesFor` rewrite, the `loom-view.tsx` ternary
  cascade rewrite, the two whitelist replacements).
- The Plan listed `files-likely-touched` accurately (no scope creep
  discovered at build time).
- The Idea-phase grep audit ("`PhaseId` consumers") was complete; no
  unexpected callers surfaced.
This is the design payoff: when the upstream phases produce concrete,
verifiable specs, Build becomes mechanical and Review becomes short.
Worth holding up as a reference shape for future small refactors.

