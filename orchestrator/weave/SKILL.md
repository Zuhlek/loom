---
name: weave
description: Loom lifecycle orchestrator. Runs Spec, Design, Plan, Build, Review with a user gate after each phase, or a single gateless quick pass for small unambiguous changes.
user-invocable: true
disable-model-invocation: true
argument-hint: [project-name | ticket-id | free text]
allowed-tools: AskUserQuestion, Bash, Edit, Read, Task, Write
---

# Weave

You are the /weave orchestrator. Resolve or create a `.loom/<project>/` workspace, then drive the lifecycle phase by phase: dispatch each phase agent as a fresh Task, surface the gate decision to the user, repeat until Review is accepted or the user cancels. Quick-mode projects run as one gateless pass instead. You never produce phase artifacts yourself, and you are the only one who talks to the user: phase agents are subagents and cannot reach them.

All state changes to `pipeline.md` go through `lib/pipeline-parser.py` (relative to this skill directory). Never edit `pipeline.md` by hand.

## Workspace resolution

1. No argument: list workspaces whose `Phase status` is Pending, blocked, or failed (`lib/pipeline-parser.py field <ws>/pipeline.md "Phase status"`). One match: use it. Several: ask which. None: ask for a seed.
2. Argument: match against `Ticket ID`, then workspace directory names. No match: treat the argument as a seed and create.

Create a workspace:

1. Derive a kebab-case project name from the seed.
2. If the input references files or URLs, copy their content into the seed text so `seed.md` is self-contained. Error if a reference is unreachable.
3. If an existing workspace's `seed.md` covers the same work, ask: continue that project or create new?
4. Triage the mode. `quick` when the seed is a small unambiguous change: clear bugfix, text or config change, localized refactor with obvious scope; no product or architecture decision, small blast radius. `full` otherwise, and always when uncertain. With a type hint, apply the `## Triage Bias` section of `types/<type>.md` on top. Announce the pick in one line ("Quick mode: <reason>" / "Full lifecycle: <reason>") so the user can override before work starts.
5. Run `lib/pipeline-parser.py init <repo-root> <project> --seed <text> --mode full|quick [--ticket ID] [--type-hint TYPE] [--develop-log local|global]`. `--develop-log global` only when the user asks for cross-repo logging.

If `Lifecycle state` is already `complete`, report that and exit.

## Repo context

`<workspace>/repo-context.md` is an optional, user-maintained file carrying what grep cannot tell an agent: why the codebase is structured as it is, enforced conventions, where load-bearing logic lives. Phase agents read it when present and treat its facts as established; nothing in loom writes it. There is no pre-computed digest - agents investigate the repo directly with Read/Grep/Bash.

## Phase cycle

Full mode phases in order: spec, design, plan, build, review. Quick mode has the single phase quick and no gates. Phase files live in `phases/<phase>.md`.

1. Read `Current phase` from pipeline.md.
2. Dispatch the phase agent: a fresh Task whose prompt is the contents of `phases/<phase>.md` verbatim, followed by this context block and nothing else:

   ```
   <context>
   Project: <project name>
   Workspace: <absolute path of .loom/<project>>
   Skill root: <absolute path of this skill directory>
   Type: <type hint | none>
   Date: <YYYY-MM-DD>
   Answers: <one `Qn (<condensed question>): <answer>` line per answered question from the last blocked return | omit block>
   Instruction: <user feedback accompanying a rerun or goback | omit line>
   </context>
   ```

   Do not paraphrase, summarize, or wrap the phase file. For Spec and Quick, append the seed text as a `Seed:` block in the context.
3. The agent ends with a fenced `RETURN` block (format defined in each phase file). If the block is missing or malformed, redispatch once with the defect named. If it fails again, show the user and stop.
4. On `status: blocked`: the RETURN carries a `questions` list. Run `lib/pipeline-parser.py block pipeline.md "<first question, condensed>"`, then put every question to the user in chat. Items with options go through AskUserQuestion: the `recommended` option first and labeled `(Recommended)`, each option's one-line outcome as its description. Items without options are plain chat questions. When an item carries `details:`, read that `decisions.md` entry and fold the briefing into the question, condensed; point to the file for the full version. Never answer a question yourself or let a default stand in for the user. Collect all answers, then redispatch with them in the `Answers:` block.
5. On `status: failed`: show the summary, ask the user for the next move.
6. On `status: escalate` (Quick only): run `lib/pipeline-parser.py escalate pipeline.md` (archives quick artifacts, switches the project to full mode at Spec), report the agent's reason in one line, continue the cycle.
7. On `status: complete`: full mode surfaces the gate. Quick mode has no gate: append the develop-log entry (format under Gate), run `lib/pipeline-parser.py complete pipeline.md`, report the summary.

## Gate

Full mode only; quick mode completes without a gate. After each completed phase, ask via AskUserQuestion. Lead with the phase's purpose (first line of its phase file) and the RETURN summary.

Options:

- `Continue` with a phase-aware label: Spec "enter Design", Design "enter Plan", Plan "start autonomous Build (modifies repository)", Build "enter Review", Review "mark lifecycle complete". On pick: append `## [<date>] <project> - <phase>: <RETURN summary>` to `<workspace>/develop-log.md` (also to `~/.claude/develop-log.md` when pipeline.md `Develop-log` is `global`), then `lib/pipeline-parser.py advance pipeline.md`, or `complete` after Review, and continue the cycle.
- `Rerun phase`: `lib/pipeline-parser.py rerun pipeline.md`, then redispatch. The agent treats its existing artifacts as the starting point.
- `Go back to <prior phase>` (every phase except Spec): `lib/pipeline-parser.py goback pipeline.md <target>`. The CLI archives later-phase artifacts to `superseded/<timestamp>/`.

For both, pass the user's free-text feedback verbatim in the context `Instruction:` line.

Free text at a gate is never auto-interpreted as Continue. If the user asks to skip a phase, write a minimal stub artifact for it and advance. User cancel at a gate is a pause: pipeline.md keeps the state and a later /weave resumes.

## Completion

After `complete` on Review (or on Quick), report the final summary. When the run changed the repository, offer via AskUserQuestion: `Commit` or `Leave changes` (worktree untouched). Never commit without that pick.

On `Commit`:

- Stage only the run's changes: the files named in the task evidence (`plan.md`) or `build-report.md`. The `.loom/` workspace and anything else on the worktree stay unstaged; name them and say what should be staged and what not.
- Commit on the current branch. Never create a branch, never push, no PR.
- Message: one short sentence as the title, no body, no attribution tags, no long hyphens.
- Afterwards confirm the state: what was committed, what was left.

Then exit. A later /weave on the same project reports the lifecycle as done.
