# Tune

Meta-layer for Loom. Curates the develop-log into skill and type-file improvements.

| Mode | Trigger | Output |
| --- | --- | --- |
| Feedback | `/tune <text>` | Append entry to `log/feedback.md` |
| Review | `/tune review` | Propose and apply SKILL.md / type edits from unapplied log entries |
| Insights | `/tune insights` | Analyze transcripts, append findings to `log/audit.md` |
| Status | `/tune` | List unapplied log entries grouped by theme |

See `SKILL.md` for the full contract. Develop-log shards live at `~/.claude/skills/log/{ideate,build,feedback,audit}.md`.
