---
name: explore-prototype
description: Explore a running sales demo prototype via Puppeteer to extract requirements; output feeds a /weave project seed.
user-invocable: true
disable-model-invocation: true
argument-hint: <url> [source-dir] [project-name]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__puppeteer__puppeteer_navigate, mcp__puppeteer__puppeteer_screenshot, mcp__puppeteer__puppeteer_click, mcp__puppeteer__puppeteer_evaluate, mcp__puppeteer__puppeteer_fill, mcp__puppeteer__puppeteer_hover, mcp__puppeteer__puppeteer_select
---

# Explore Prototype

Systematically explore a running sales demo prototype to extract requirements. Produces a structured analysis intended to seed a `/weave` project — without adopting any prototype code.

## Relationship to /weave

This skill is **not** dispatched by the `/weave` orchestrator. It is user-invocable and runs standalone, ahead of (or alongside) the lifecycle. Its output `prototype-analysis.md` is intended to be referenced from or copied into `.loom/<project>/seed.md` when bootstrapping a new project. See the "Feeding the analysis into /weave" section below.

Whether to also wire this skill into the `/weave` lifecycle as an optional pre-Spec phase is an open design question — for now the skill stands alone.

## Arguments

- `/explore-prototype http://localhost:3000` — explore prototype at URL, ask for project name
- `/explore-prototype http://localhost:3000 my-app` — explore with explicit project name
- `/explore-prototype http://localhost:3000 ./prototype-src my-app` — explore with source directory for surface-level code reading
- `/explore-prototype my-app` — resume exploration for existing project (looks for `.loom/<project>/prototype-analysis.md` in progress)

## Setup

1. Parse arguments: extract URL, optional source directory, and project name
2. If no project name given, derive from URL hostname or ask via AskUserQuestion
3. **Ensure Puppeteer MCP is available** (see "Puppeteer Infrastructure" below)
4. Create `.loom/<project>/prototype-screenshots/` directory
5. **Create the screenshot helper script** (see "Saving Screenshots to Disk" below)
6. Verify the URL is reachable by navigating to it with Puppeteer
7. If resuming (no URL, just project name): read existing `prototype-analysis.md` and ask user what to re-explore

## Puppeteer Infrastructure

Before starting the crawl, verify that Puppeteer MCP tools are available. If they are not:

1. **Check if `@modelcontextprotocol/server-puppeteer` is installed globally:**
   ```bash
   npm list -g @modelcontextprotocol/server-puppeteer 2>&1
   ```
2. **If not installed, install it:**
   ```bash
   npm install -g @modelcontextprotocol/server-puppeteer --registry https://registry.npmjs.org
   ```
3. **Check if `.mcp.json` exists in the project root and contains a puppeteer entry.** If not, create or update it:
   ```json
   {
     "mcpServers": {
       "puppeteer": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
       }
     }
   }
   ```
4. **If `.mcp.json` was just created or modified**, inform the user that they need to restart the Claude Code session for the MCP server to load, then stop. Do NOT proceed without working Puppeteer tools.
5. **Verify availability** by checking if `mcp__puppeteer__puppeteer_navigate` is in the available tools list (use ToolSearch if needed).

## Saving Screenshots to Disk

The Puppeteer MCP `puppeteer_screenshot` tool does NOT save files to disk by default. When called with `encoded: true`, it returns base64 data — but this is too large for the context window and gets saved to a tool-results overflow file instead. Use this two-step process for EVERY screenshot:

### Step 1: Create the helper script (once, during Setup)

```bash
cat << 'PYSCRIPT' > /tmp/save_puppeteer_screenshot.py
import json, sys, base64, os
output_path = sys.argv[1]
input_file = sys.argv[2]
data = json.load(open(input_file))
for item in data:
    text = item.get('text', '')
    if text.startswith('data:image/png;base64,'):
        b64 = text.split(',', 1)[1]
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved: {output_path}')
        break
else:
    print(f'ERROR: No base64 image found in {input_file}', file=sys.stderr)
    sys.exit(1)
PYSCRIPT
```

### Step 2: For each screenshot

1. Call `puppeteer_screenshot` with `encoded: true`. The result will overflow to a file like:
   `/Users/claude/.claude/projects/.../tool-results/mcp-puppeteer-puppeteer_screenshot-TIMESTAMP.txt`
2. The error message contains the overflow file path. Extract it.
3. Run: `python3 /tmp/save_puppeteer_screenshot.py "<target-path>.png" "<overflow-file-path>"`

**IMPORTANT:** Always use `encoded: true` when taking screenshots. The non-encoded mode only displays the image in the conversation but does NOT save it to disk.

## Phase 1 — Automated Crawl

Systematically discover and document every visible page and interaction:

1. **Navigate to the root URL** — take a screenshot, record the page title and URL
2. **Discover navigation elements** — use `puppeteer_evaluate` to extract:
   - All `<a>` links with their href and text
   - Navigation menus (`<nav>`, role="navigation")
   - Buttons that appear to be navigation (sidebar items, tab bars)
   - Any visible menu structures
3. **Visit each discovered page** — for each unique internal link:
   a. Navigate to the URL
   b. Take a screenshot → save to `.loom/<project>/prototype-screenshots/<page-name>.png`
   c. Record: page title, URL path, visible UI elements (headings, forms, tables, buttons)
   d. Discover any sub-navigation or deeper links from this page
4. **Explore interactive elements** — for pages with forms, modals, or multi-step flows:
   a. Click buttons that reveal hidden UI (dropdowns, modals, accordions)
   b. Screenshot each revealed state
   c. Note form fields and their labels (these reveal data entities)
5. **Build a page map** — a list of all discovered pages with their relationships

### Crawl Rules

- Stay within the same origin (don't follow external links)
- Limit depth to 3 levels of navigation
- Screenshot each unique view state (not just each URL — modals and tabs count)
- Name screenshots descriptively: `01-home.png`, `02-dashboard.png`, `03-settings-modal.png`
- If the app requires login, stop and proceed to Phase 2 to ask the user for credentials

## Phase 2 — User-Guided Follow-up

Present findings and ask the user to fill gaps:

1. **Summarize discovered pages** — list all pages found with one-line descriptions
2. **Ask via AskUserQuestion:**
   - "Are there pages or flows I missed? (e.g., behind login, hidden menus, specific user roles)"
   - "Are there important user journeys I should trace end-to-end? (e.g., 'create an order', 'generate a report')"
   - If login was required: "Can you provide test credentials or walk me through the login?"
3. **Explore user-directed areas:**
   - Navigate to any pages the user points out
   - Trace user journeys step by step (click through the flow, screenshot each step)
   - If credentials provided, log in and re-crawl authenticated areas
4. **Repeat** if the user identifies more areas, until they confirm exploration is complete

## Phase 3 — Optional Source Scan

**Only if a source directory was provided.** Read surface-level code to supplement visual findings:

### What to read (Surface only):
- **Route definitions:** Express routes, Next.js pages, React Router config, API endpoint files
- **Data models:** TypeScript interfaces/types, database schemas, ORM models, JSON schemas
- **Configuration:** Environment variables that reveal integrations, feature flags

### What NOT to read:
- Business logic implementations
- Utility functions
- Test files
- Styling code
- Build configuration

### How to find relevant files:
1. Look for common patterns:
   - `routes/`, `pages/`, `api/` directories
   - Files named `*model*`, `*schema*`, `*type*`, `*interface*`
   - `prisma/schema.prisma`, `*.entity.ts`, `models/*.py`
2. Read only the file signatures — types, interfaces, route paths, method names
3. **Label all findings:** Every piece of information from code must be prefixed with "⚠️ Inferred from throwaway prototype — not an implementation reference."

## Phase 4 — Analysis Output

Write the structured analysis to `.loom/<project>/prototype-analysis.md` using the format defined in `analysis-template.md`:

1. **Read the template** at `orchestrator/explore-prototype/analysis-template.md` for the exact output format
2. **Fill each section** with findings from Phases 1-3:
   - **Discovered Screens:** Table of all pages/views with screenshot references
   - **User Flows:** Step-by-step sequences of how users accomplish tasks
   - **Data Entities:** Entities inferred from UI (form fields, table columns, list items) — NOT from code
   - **API Surface:** Only if source-dir was provided; routes and data shapes (marked as throwaway-derived)
   - **Business Rules Observed:** Behavioral patterns observed during interaction
   - **Open Questions:** Ambiguities, unclear behaviors, areas needing stakeholder input
3. **Footer:** Always include the disclaimer that this analysis derives from a throwaway prototype

## Feeding the analysis into /weave

When the prototype analysis is complete, the user typically wants to start a `/weave` project from it. Two options:

1. **Reference:** Run `/weave` with a seed like *"Build the app described in `.loom/<project>/prototype-analysis.md`"*. The Spec phase agent's repository pre-flight will pick up `prototype-analysis.md` alongside the repo surface.
2. **Inline:** Copy the analysis content into `.loom/<project>/seed.md` before starting `/weave`.

Either path keeps the prototype analysis as the canonical source of *what* to build without adopting prototype code.

## Logging

After completing the exploration, append the same entry to BOTH surfaces (dual-write, per Loom's learning-log discipline):

- `.loom/<project>/develop-log.md` — project-local raw observations
- `orchestrator/log/ideate.md` — global learning shard (spec-phase observations live here per Review's dual-write contract)

Entry format:

```markdown
## YYYY-MM-DD - <project-name> - Prototype Exploration
**Skill:** explore-prototype
**URL:** [prototype URL]
**Source scan:** [yes/no]
**Pages discovered:** [count]
**User-guided additions:** [count of pages added in Phase 2]
**What worked:** [brief]
**Problems:** [brief]
**Proposed change:** [exact edit or "none"]
```

## Rules

- **Visual-first.** The primary discovery channel is Puppeteer screenshots and interaction. Code reading is supplementary and optional.
- **No code pollution.** Never suggest using prototype code as a starting point. The analysis describes *what* to build, not *how*.
- **Surface code only.** If source is provided: routes + data models. No business logic, no utility code, no implementation details.
- **Label code-derived findings.** Everything from source reading gets the ⚠️ throwaway warning.
- **Be thorough in crawling.** Click through tabs, expand accordions, open modals. Hidden UI reveals requirements.
- **Ask, don't guess.** If unsure whether a UI element is important, include it in Phase 2 questions.
- **Screenshots are the artifact.** They're the primary evidence for the downstream Spec phase. Name them clearly and reference them in the analysis.
