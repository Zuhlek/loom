---
name: explore-prototype
description: Explore a running prototype visually and produce Design evidence without adopting prototype code.
user-invocable: true
argument-hint: <url> [source-dir] [project-name]
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Explore Prototype

Explore a running prototype to extract requirements for Design.

## Outputs

- `.loom/<project>/prototype-analysis.md`
- `.loom/<project>/prototype-screenshots/`

## Flow

1. Resolve URL, optional source directory, and project name.
2. Create `.loom/<project>/prototype-screenshots/`.
3. Navigate the prototype visually first.
4. Capture pages, modals, tabs, and multi-step states.
5. Ask the user for missed flows, roles, credentials, or hidden states.
6. If a source directory is provided, read only routes, data shapes, config, and model signatures.
7. Write `prototype-analysis.md` using `analysis-template.md`.

## Rules

- Stay inside the same origin.
- Screenshots are evidence; name them clearly.
- Prototype source is evidence for what to build, not implementation reference.
- Label every source-derived statement as throwaway-prototype inference.
- Do not read business logic, tests, styling, or utility internals.
