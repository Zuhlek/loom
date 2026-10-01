# reporting Type

Accumulated guidance for cinnamon reporting projects. `cinnamon-reporting` is the common code base all reporting projects share — report definitions, building blocks, rendering, API services, and UI components.

## Package Ecosystem

The reporting domain spans multiple workspace packages in the cinnamon monorepo:

| Package | Role | Tech |
|---------|------|------|
| **cinnamon-reporting** (v24.6.0) | Core engine: execution, scheduling, rendering, APIs | Node/TS, Express, MongoDB, Redis |
| **cinnamon-reporting-ui** (v0.1.0) | Report designer/admin portal | React, Zustand, MUI, Vite |
| **cinnamon-report-viewer** (v1.0.0) | Read-only report viewer for end users | React, Zustand, Vite |

### Workspace Dependencies (consumed by cinnamon-reporting)
- **cinnamon-api** — Shared API models: `Execution`, `ReportType`, `ReportOrder`, `ParameterDefinition`, `ReportFormat`, `ValueType`, `TranslatableText`
- **cinnamon-base** — Utilities: `DateCalculator`, `DatePeriod`, `Mutex`, `Semaphore`
- **cinnamon-server-base** — Server infra: `Database`, `ExcelGenerator`, `ObjectCache`, `HierarchicalObjectCache`, `AbstractMaster/Worker`, `MessageReceiver`, `GroupMessageReceiver`, `Authenticator`, `CSVReader`

## Core Architecture

### Three-Phase Pipeline

1. **Definition** — `ReportType` → tree of `DefinitionNode` (building blocks)
2. **Production** — `BuildingBlock.produce(context)` → `ReportNode` tree → `AbstractReport`
3. **Rendering** — `AbstractReport` (the serializable ReportNode tree) is sent to rendering channels → Excel (ExcelCreator), Word/PDF (WordChannel), HTML

### Key Patterns

- **BuildingBlock**: Abstract class with `produce(context: ReportingContext): Promise<ReportNode>`. Concrete: ParagraphBB, SectionBB, ChartBB, RichTextBB, ErrorBB, etc. Registered in `BBRegistry`. A building block typically fetches data from the `DataSource` interface (implemented in the solution).
- **ReportNode tree / AbstractReport**: `ReportNode` with `nodeType` discriminator, parent/children, TranslatableText titles, `HidingPolicy`, `RenderingOptions`. Specialized: `SectionNode`, `VerticalTableNode`, `PivotTableNode`, `ChartNode`, `ImageNode`, `ToggleNode`. The `AbstractReport` is the serializable form of this tree — it's what gets sent to rendering channels.
- **ParameterSet / ProductionParameterSet**: Immutable key-value with parent linkage for hierarchical override. Type-safe getters. `ParameterExpression` supports `=` prefixed JS expressions.
- **ReportingContext**: Execution context providing data sources, parameters, logging, validation, ID generation, translation/formatting. Lazily initializes stores and manages per-execution cache lifecycle.
- **ReportingParameters**: 60+ standard parameter definitions (mainTitle, subTitle, style, chartType, hidingPolicy, renderingOptions, etc.).

### Base Services & ServiceRegistry

Core interfaces in `ExternalServices/BaseServices.ts` define the service contracts. Solutions implement these interfaces; `ServiceRegistry` auto-detects and registers them.

| Interface | Responsibility |
|-----------|---------------|
| **DataSource** | Data access during report production — segmentations, portfolio availability, translations. Building blocks fetch data through this. Implemented by each solution. |
| **ReportStore** | Persists report orders, executions, profiles, abstract reports, and rendered output (GridFS for binaries). |
| **ResourceStore** | Manages report-building resources: translations, report types, segmentations, templates, dictionaries, figures catalogs. |
| **ContentStore** | Authored content management: content types, versions, language-specific content, attachments. |
| **PortalStore** | Portal catalog portfolios per channel. |

**Key pattern**: All interfaces support `getExecutionInstance(context)` and `getUserInstance(context)` for per-execution/per-user state isolation.

**ServiceRegistry** (singleton) registers services by interface detection:
```typescript
ServiceRegistry.instance.register(service); // auto-detects which interfaces it implements
```

**ReportingContext** is the primary access point during report production. It wraps the registered services and provides per-execution instances:
```typescript
context.dataSource       // per-execution DataSource instance
context.resourceStore    // lazily initialized, per-execution
context.reportStore      // lazily initialized, per-execution
context.contentStore     // lazily initialized, per-execution
```
ReportingContext also manages the execution's parameter hierarchy, logging, validation, ID generation, translation/formatting, and cache lifecycle (adding execution-level caches at start, cleaning up after).

### Caching Architecture

Caching during report production is critical. `CachingService<T>` (in `ExternalServices/ExternalService.ts`) is the base class all store implementations extend.

**Cache hierarchy** (configurable per service):
- **L0 shared** — Redis or SharedObjectCache, shared across the cluster
- **L1 process** — Per-worker LRUCache (optional, `processL1` config)
- **L1 execution** — Per-execution LRUCache (optional, added/removed per execution lifecycle)

These form a `HierarchicalObjectCache` chain for efficient lookup.

**Configuration** (`CacheConfiguration`):
```typescript
{ type: 'lru' | 'redis' | 'none', processL1?: {...}, executionL1?: {...}, shared?: boolean, managed?: boolean }
```

**ReportingContext integration**: Stores are lazily initialized; `refreshCache` parameter triggers cache invalidation. Execution caches are added at production start and cleaned up after.

**Cache flushing**: Workers flush their `localCaches` (LRU); ServerMaster/K8s master flushes `sharedCaches` (Redis).

### Store Implementations

All store backends follow the same pattern: extend `CachingService<Connector>` and implement one or more store interfaces. The connector handles low-level backend communication; `CachingService` provides the caching layer on top.

Available backends in `ExternalServices/`:
- **MongoServices** — `MongoDBConnector` + MongoDB/GridFS
- **FileServices** — `FileConnector` + filesystem
- **MySQLServices** — `MySQLReportStoreConnector` + MySQL/MariaDB

Each backend provides concrete classes for the store interfaces it supports (e.g., `MongoReportStore implements ReportStore`, `FileResourceStore implements ResourceStore`, etc.). Solutions choose and configure which backend to use.

### Execution Flow

```
ReportOrder → ExecutionBuilder → Execution(s)
  → Redis stream (priority-based) → ReportExecutor worker
  → ReportingContext + DefinitionNode traversal
  → AbstractReport → DB storage
  → (if rendering) → ExcelCreator / WordChannel worker
  → Binary output → GridFS
```

### Excel Generation

- Template-driven via `ExcelCreator` using `CellPattern` system from named regions in Excel templates.
- Pattern naming: `{style}.{nodeType}`, `fact.{valueType}.{importance}`, `columnHeader.{valueType}`, etc.
- Handles VerticalTableNode/PivotTableNode with row groups, dimension hierarchies, importance levels.
- Optional tracing sheet for debugging pattern resolution.

### REST APIs (typescript-rest)

19 API services in `APIServices/`:
- `ExecutionsService` — CRUD, filtering, report retrieval
- `ReportOrderService` — submit/manage orders
- `ContentManagementService` — report type versioning
- `CatalogService`, `SchedulingService`, `ResourceService`, `TranslationService`, `AdminService`, etc.
- Decorators: `@Path`, `@GET`, `@POST`, `@Security`, `@Produces`, `@Tags`

### Worker Architecture & Deployment

**Worker types**:
- **WebServer** — Serves the REST API (Express + typescript-rest services)
- **ReportExecutor** — Produces reports by claiming executions from Redis streams and running the production pipeline
- **WordRenderer** — Renders AbstractReports to Word/PDF via the external WordChannel service
- **ExcelRenderer** — Renders AbstractReports to Excel using ExcelCreator and templates
- **CatalogManager** — Maintains report catalogs (pre-rendered portal content)
- **Scheduler** — Triggers scheduled report executions based on cron-like definitions
- **BackgroundWatchdog** / **ServerWatchdog** — Health monitoring and recovery
- **Solution-specific workers** — Custom workers defined via `SolutionConfigurator`

**Two deployment modes**:

1. **ServerMaster (cluster module)** — A master process reads cluster config and forks workers:
   ```
   ServerMaster → N x WebServer, N x ReportExecutor, N x WordRenderer, ...
   ```
   Configured via `config.cluster.webServerWorkers`, `config.cluster.executionWorkers`, etc.

2. **Kubernetes** — Each pod/container runs a single worker type. No ServerMaster needed — K8s itself orchestrates. Worker role is determined by environment variables (`workerType`, `workerIndex` in `Configuration`). K8s handles scaling, restarts, and distribution.

## Development Guidelines

### Before Creating or Modifying Building Blocks
- Read the existing `BBRegistry` and comparable BuildingBlock implementations first
- BuildingBlocks must be async and produce well-typed ReportNodes
- Always provide `getDescription(): BBDescription` for documentation
- Building blocks fetch data via `DataSource` — the interface is implemented in the solution, not in cinnamon-reporting

### Before Modifying Parameters
- Check `ReportingParameters` for conflicts with the 60+ existing standard parameters
- ProductionParameterSet inherits from parent — don't break the hierarchy

### Before Modifying API Services
- Services use `@cinnamon/typescript-rest` decorators — verify decorator imports
- Check `Authenticator` security roles (`SecurityRole.SERVICE`, `SecurityRole.SSO`)
- Body parser is configured for up to 1GB (binary uploads)

### Before Modifying Excel Rendering
- Read ExcelCreator's CellPattern resolution chain — pattern fallback order matters
- Test with the tracing sheet enabled (`traceSheet: true`) to debug pattern mismatches
- Templates are externally managed Excel files — coordinate template changes with report changes

### Before Modifying Caching
- Understand the cache hierarchy (L0 shared → L1 process → L1 execution)
- Execution caches have a lifecycle — added at production start, removed after
- Cache flushing is distributed: workers flush local, master flushes shared

### Testing
- Tests require MongoDB (use `npm run init-mongo` or `init-mongo-with-replica`)
- `jest --run-in-band` — tests run sequentially (DB state shared)
- 47 test files in `/test` covering blocks, rendering, APIs, MongoDB, scheduling

### Consumer Impact
- **crs-ciss** and **crs-sgkb** consume cinnamon as a library — changes to exported APIs or models require checking both consumers
- `cinnamon-core-reporting` extends `cinnamon-reporting` — verify compatibility when changing base classes

## Triage Bias

- **Standard track** by default — reporting changes often touch multiple packages (engine + API + UI)
- **Quick track** only for isolated bug fixes in a single file/package
- **Deep track** for: new BuildingBlock types, new rendering formats, execution pipeline changes, new API services

## Exploration Checklist

When analyzing a reporting task:
1. Identify which package(s) are affected (see ecosystem table)
2. Check if the change touches the three-phase pipeline boundary (definition ↔ production ↔ rendering)
3. Verify parameter compatibility with ReportingParameters
4. Check consumer repos if exported API surface changes
5. Review related test files before modifying production code
