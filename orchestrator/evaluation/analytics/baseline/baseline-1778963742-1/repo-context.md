# Repo Context — baseline-1778963742-1

## Project nature

This fabric is a **greenfield** project. Per the seed, it is a tiny local-only
"Bookmarks" web app built from scratch — single user, single laptop, no auth, no
deploy. It does NOT extend or integrate with any existing application in this
repo.

## Workspace isolation (hard harness constraint)

The seed opens with a `HARNESS-DIRECTIVE` block pinning ALL deliverable files to
`./app/` relative to this workspace. Concretely, every deliverable —
`package.json`, `tsconfig.json`, source code, tests, build output, `node_modules`,
the SQLite file, anything `npm` writes — MUST live inside:

```
/Volumes/My Shared Files/repo/loom/.loom/baseline-1778963742-1/app/
```

Never write deliverables to the repo root, to `orchestrator/`, or to any sibling
`.loom/<project>/` workspace. `npm start` and `npm test` MUST be runnable from
that `./app/` directory. Multiple baseline runs execute in adjacent workspaces
and would overwrite each other if this were violated.

This constraint is surfaced in `spec.md` `## Constraints` and downstream phases
(Design / Plan / Build) MUST NOT relax it.

## Stack — pinned by the seed (no substitutions allowed)

- Language: TypeScript everywhere (server + client).
- Backend: Node + Express, single process.
- Storage: SQLite via `better-sqlite3`, file on disk next to the server (inside
  `./app/`).
- Frontend: plain HTML + CSS + vanilla TypeScript, compiled to a single JS
  bundle via `esbuild`. **No** React, Vue, or any framework.
- Tests: Vitest.
- Run command: `npm start` boots the server on `http://localhost:3000` and serves
  the UI from the same origin.
- Test command: `npm test`.

## Cross-references to the repo digest

See `.loom/.cache/repo-digest.md` for stable facts shared across fabrics:

- §"Host repo identity" — confirms greenfield fabrics are independent codebases
  that do not import from the orchestrator or its UI workspace.
- §"Conventions a fabric agent should know" — fabric workspaces are free to
  choose their own language and tooling without coordinating with the
  orchestrator. (This fabric still pins its stack via the seed.)
- §"What this digest does NOT establish" — stack choices are seed-level
  decisions, which this seed makes explicitly.

## Prior art / integration points / files likely to be edited

- Prior art in this repo: none relevant. The orchestrator's `ui/` workspace uses
  pnpm + a different stack; it is NOT imported.
- Integration points: none. The app is local-only with no external network
  calls.
- Files likely to be edited: all files are NEW under
  `.loom/baseline-1778963742-1/app/`. There are no pre-existing fabric files.

## Foundation facts the seed already settles

The seed is unusually self-contained. The five user-asked branching questions
(tags vs flat, duplicate handling, search, edit, sort) are explicitly enumerated.
The seed also pins success criterion (works locally), value bar (clean
four-feature app, no nice-to-haves), and platform envelope (single user, single
laptop, no auth, no deploy). Foundation grilling is therefore SKIPPED — grilling
goes directly to the five seed-listed branching questions Q01–Q05.

## Out-of-repo facts grilling will need to ask

The five seed-listed questions are the only branching uncertainty. They are
resolved via the non-interactive `.answers.yaml` queue (favouring the
minimal-surface direction: flat list, reject duplicates, no search, immutable,
newest-first).
