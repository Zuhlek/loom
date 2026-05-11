# Prototype Analysis — {{project-name}}

**Prototype URL:** {{url}}
**Explored on:** {{date}}
**Source directory:** {{source-dir or "not provided"}}

---

## Discovered Screens

| # | Screen Name | URL / Path | Screenshot | Description |
|---|---|---|---|---|
| 1 | {{name}} | {{url-path}} | `prototype-screenshots/{{file}}` | {{one-line description}} |

---

## User Flows

### Flow 1: {{flow-name}}
> {{one-sentence summary of what the user accomplishes}}

| Step | Screen | Action | Result |
|---|---|---|---|
| 1 | {{screen-name}} | {{what the user does}} | {{what happens}} |

---

## Data Entities

Entities inferred from UI elements (form fields, table columns, list items, labels).

| Entity | Discovered In | Fields / Attributes | Notes |
|---|---|---|---|
| {{entity-name}} | {{screen where observed}} | {{field1, field2, ...}} | {{relationships, constraints}} |

---

## API Surface

> ⚠️ Inferred from throwaway prototype — not an implementation reference.
> This section is only populated when a source directory was provided.

| Method | Route | Request Shape | Response Shape | Notes |
|---|---|---|---|---|
| {{GET/POST/...}} | {{/api/...}} | {{body fields or —}} | {{response fields}} | {{purpose}} |

---

## Business Rules Observed

Behavioral patterns observed during UI interaction — what the app enforces, validates, or restricts.

| # | Rule | Observed In | Evidence |
|---|---|---|---|
| 1 | {{rule description}} | {{screen/flow}} | {{what was observed}} |

---

## Open Questions

Ambiguities, unclear behaviors, and areas needing stakeholder input before development.

| # | Question | Context | Why It Matters |
|---|---|---|---|
| 1 | {{question}} | {{where this came up}} | {{impact on development}} |

---

*This analysis is derived from a throwaway prototype. Do not reference prototype code for implementation.*
