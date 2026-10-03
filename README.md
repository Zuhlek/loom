# Loom

Phase-based development framework for AI-agent software work. One skill: `/weave`.

## How it works

`/weave` resolves or creates a workspace at `.loom/<project>/` in the target repo and triages the seed. Small unambiguous changes run in quick mode: one gateless pass (phase `quick`) that implements, verifies, and reports; if the agent hits a real decision it escalates and the project restarts as a full lifecycle. Everything else runs five phases in order, each as a fresh subagent: Spec (clarify the seed into `spec.md` + `decisions.md`), Design (`design.md`), Plan (`plan.md` with the task graph), Build (implementation + `build-report.md`), Review (`review.md`). After every full-mode phase the user decides at a gate: continue, rerun, or go back. Reruns are never automatic.

Phase agents never talk to the user directly. A phase with open questions returns `blocked` with a question batch; the orchestrator shows the questions in chat as multiple choice (full briefings live in `decisions.md`) and redispatches with the answers.

`pipeline.md` is the canonical state file per workspace. The orchestrator mutates it only through `orchestrator/weave/lib/pipeline-parser.py` (init, advance, rerun, goback, complete, block, escalate). `goback` and `escalate` archive superseded artifacts to `superseded/<timestamp>/`.

Each phase dispatch is the phase file sent verbatim plus a short context block (project, workspace path, skill root, type, date, pending answers, optional rerun instruction). Phase agents return a fenced RETURN block (phase, status, artifacts, summary); a malformed return is redispatched once.

The orchestrator appends each accepted phase's one-line summary to `<workspace>/develop-log.md`; projects initialized with `--develop-log global` also append to `~/.claude/develop-log.md`. `<workspace>/repo-context.md` is an optional, user-maintained context file; nothing in loom writes it.

## Layout

| Path | Purpose |
| --- | --- |
| `orchestrator/weave/SKILL.md` | `/weave` orchestrator |
| `orchestrator/weave/phases/<phase>.md` | One self-contained file per phase agent |
| `orchestrator/weave/lib/pipeline-parser.py` | pipeline.md CLI; `test_pipeline_parser.py` checks it |
| `orchestrator/weave/principles.md` | Engineering rules read by Build and Review |
| `orchestrator/weave/types/<type>.md` | Domain guidance loaded when a project has a type hint |
| `orchestrator/install.sh` | Links `~/.claude/skills/weave` to this repo (junction on Windows) |

## Install

```bash
./orchestrator/install.sh
```

Re-run after moving the repo. No hooks, no settings changes. The parser needs Python 3.

Verify: `python orchestrator/weave/lib/test_pipeline_parser.py` prints `ok`.
