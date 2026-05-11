# Forge

From the deep mines where raw ideas sleep, through the fires where code is tempered and shaped — the Forge remembers every strike. What was learned is not forgotten. What was forged makes the next blade sharper. A development process for Claude Code, built to compound knowledge across sessions — so that no lesson is lost, and no mistake is made twice.

**Author:** Artur Melo

## Setup

From the bmpi-ai-tools repo:

```bash
./forge/setup-forge.sh
```

This symlinks `/idea`, `/build`, `/review`, and shared `types/` into `~/.claude/skills/` and creates your personal develop-log (gitignored).

## Skills

| Skill | Purpose | Usage |
|---|---|---|
| `/idea` | Spec — turn a rough idea into a plan with tasks | `/idea [type] <description>` |
| `/build` | Execute — pick up a planned project and build it | `/build [type] <project-name>` |
| `/review` | Audit — curate learnings, analyze transcripts, improve skills | `/review [log \| transcripts \| full]` |

Run them in sequence: `/idea` first, then `/build` when planning is done. Run `/review` periodically to fold learnings back into skills and type files.

## Workflow

```
/idea cloud-infra setup auth service     ← spec phase
    produces .forge/setup-auth-service/
      idea.md, plan.md, questions.md, task.md, ticket.md

/build cloud-infra setup-auth-service    ← execution phase
    executes tasks, logs learnings

/review                                  ← audit phase (periodic)
    reads develop-log + session transcripts
    proposes SKILL.md and type file improvements
```

The type (`cloud-infra`) is always optional. Without it, `/build` reads it from the idea phase.

## Type System

Types categorize work (e.g., `cloud-infra`, `ciso-tool`). They're not predefined — they emerge from usage.

**Where type knowledge lives:**
```
forge/
├── idea/
│   └── SKILL.md
├── build/
│   └── SKILL.md
├── review/
│   └── SKILL.md
└── types/
    ├── ciso-tool.md      ← shared between all skills
    └── cloud-infra.md
```

Type files are **shared team knowledge** — commit them. They're curated from the develop-log via `/review`.

## Learning Loop

```
Work on project (/idea → /build)
    → log after each phase/task (develop-log.md, gitignored)
    → /review (periodically)
        → reads develop-log (self-reported observations)
        → reads session transcripts (actual friction, user corrections)
        → patterns promoted to types/<type>.md (committed, shared)
        → process fixes applied to SKILL.md files (committed, shared)
```

- **develop-log.md** — personal, raw observations from all skills (gitignored)
- **types/*.md** — curated team knowledge (committed)
- **SKILL.md** — process refinements (committed)

## What Gets Committed

| File | Committed? | Why |
|---|---|---|
| `*/SKILL.md` | Yes | The process — same for everyone |
| `types/*.md` | Yes | Curated team knowledge |
| `README.md` | Yes | This guide |
| `develop-log.md` | No | Personal scratch pad |
