# ciso-tool Type

Patterns for the CISO security documentation tool — shared between spec and build skills.

## Architecture

- Frontend: React + TypeScript + React Flow
- Model files in `model/` directory (YAML)
- React Router with per-section color theming via CSS custom properties

## Model Structure

- **Assets:** `model/assets/*.yaml` + companion `*.md` docs
- **Blueprints:** `model/blueprints/*.yaml` (assets inherit via `extends:`)
- **Frameworks:** `model/frameworks/*.yaml` (select controls per scope)
- **Controls:** `model/controls.yaml` (global catalog, 80+ controls, 12 domains)
- **Flows:** `model/flows/flows.yaml` (single file, unidirectional edges)
- **DataTypes:** `model/dataTypes/dataTypes.yaml` (global vocabulary with CIA classification)
- **Scopes:** `model/scopes/*.yaml` (filter assets, set viewport, reference frameworks)
- **Topology:** `model/topology.yaml` (node positions, global)

## Schema Verification (Critical)

Before writing YAML changes, always verify what the app's Zod schemas support:
- `src/api/schemas/flow.ts` — flow fields (`exception_notes` is a single string — for multiple axiom violations, concatenate: "A-3: [reason]. A-7: [reason].")
- `src/api/schemas/asset.ts` — asset fields (guarantees ARE supported inline)
- `src/api/schemas/guarantee.ts` — guarantee structure (id, statement, domain, satisfies, responsible, evidence)
- Flow `dataTypes` reference IDs from the global catalog — add new types there first
- `flowType` supports: `data`, `control`, `access`, `physical`
- YAML files use camelCase (matching existing convention), despite schema field names using snake_case

## Model Data Patterns

- **Flows are unidirectional:** Model both request and response as separate flows. Every interaction needs two flows.
- **Guarantees:** Supported both in blueprints AND inline on assets. Prefer blueprints for reusable patterns, inline for one-off governance assets.
- **Blueprint naming:** Use organization-scoped names (`csag-workstation`) not narrow functional names (`dev-workstation`).
- **Governance assets:** Policies, contracts, terms are valid `Process` assets in MGMT environment with guarantees for GOV/TPO controls.

## Build Patterns

- **Dead code detection:** When migrating from single-page to React Router, check if old entry points (App.tsx) are still imported. If `main.tsx` uses `RouterProvider`, the old App component and all its children (modals, panels, state) may be entirely dead code — safe to remove.
- **React Flow:** `onConnect` handler provides drag-and-drop edge creation out of the box. Don't reimplement.
- **Bundle impact:** Removing unused modal/panel components can significantly reduce bundle size (−75 KB in one case), even when adding new features simultaneously.
- **Scope context:** `useScopeContext()` provides `loadedScope` with assets, flows, frameworks, controlsCatalog. Note `frameworks` can be undefined — always use `?? []`.
- **Navigation pattern:** Detail pages use `useNavigate` + `useLocation`, preserve `location.search` (scope query param) when navigating.
- **Command palette:** Build searchable items from scope context (assets, flows, controls, frameworks) + static page list. Group by category, support keyboard nav.
- **Class-specific pages:** Always plan for both list AND detail views per asset class. Missing detail pages surface as user feedback after build.
- **Verification:** For UI changes, verify in the browser after build (`npm run dev`, visually confirm). For model-only changes (YAML/MD), verification is schema validation + app load.

## Documentation Build Patterns

- **Load ALL referenced model data upfront** before writing docs. Partial reads lead to incomplete worked examples.
- **Run consistency checks** after each feedback round — terms, relationships, and examples can drift.
- **Symmetry check:** When introducing a new pattern, immediately check if it should be symmetric with an existing one. Asymmetry is usually a design smell.

## Planning Patterns

### Scope Review
When reviewing a scope, check systematically:
1. **Axiom validation** on all flows (A-3 through A-8) — document violations needing exception_notes
2. **Guarantee coverage** — every asset should have guarantees; blueprints are preferred over inline
3. **Flow completeness** — unidirectional model requires both request AND response flows
4. **DataType population** — no flow should have `dataTypes: []`
5. **Framework domain coverage** — check which of 12 domains are represented
6. **Document freshness** — version numbers, status headers, cross-references between files

## Triage Bias

- Model data changes (YAML/MD only) → standard track (schema verification + naming decisions)
- UI/frontend changes → standard track with possible mockup
- Scope reviews → quick track (analysis output, not implementation)
- New scope creation → deep track (architectural decisions, threat modeling)
