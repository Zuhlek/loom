# crs-ciss Type

**Extends:** reporting

Accumulated guidance for the crs-ciss monorepo — the Cinnamon Sustainability Solution. A pnpm workspace with four packages spanning ESG reporting, data ingestion, and XML workflow processing.

## Package Ecosystem

| Package | Role | Key Cinnamon Deps | Tech |
|---------|------|--------------------|------|
| **ciss-base** | Shared types, CSV parsing, messaging constants | cinnamon-api, cinnamon-base | TS |
| **ciss-solution** | ESG reporting engine — BuildingBlocks, DataSource, workers, REST API | cinnamon-reporting, cinnamon-ir, cinnamon-server-base, cinnamon-workflow | TS, MySQL/MariaDB, Redis |
| **ciss-data-loader** | File ingestion ETL — SFTP downloads, CSV mapping, staging loads | cinnamon-workflow, cinnamon-server-base | TS, MariaDB, SFTP |
| **ciss-xml-workflow** | XML file watcher — routes inbound XML to message queue | cinnamon-workflow, cinnamon-server-base | TS |

### Workspace Dependencies

```
ciss-base ← ciss-solution, ciss-data-loader, ciss-xml-workflow
cinnamon-workflow ← ciss-solution (workers), ciss-data-loader (main), ciss-xml-workflow (main)
cinnamon-reporting ← ciss-solution (only)
```

Version catalog in `pnpm-workspace.yaml` pins all cinnamon packages to a single release line (e.g., `CSD-800.2146`).

## Architecture by Package

### ciss-solution (reporting — inherits parent type)

Entry point: `ProductionEngine/CISSService.ts` — extends `SolutionConfigurator` from cinnamon-reporting.

**Key patterns:**
- **CISSConfiguration** extends `Configuration` from cinnamon-reporting — report type mappings, benchmark handling, currency conversion, XML workflow config
- **CISSReportingContext** extends `IRReportingContext` from cinnamon-ir — adds ESG-specific context (portfolio valuation, fund metadata, tracked positions)
- **EsgBB.ts** (~295KB) — `EsgBase` extends `BuildingBlock`; 20+ ESG building blocks (charts, gauges, tables, segmentation, coverage)
- **CISSDataSource** (~70KB) — implements `DataSource` interface; MySQL connection pool; portfolio/benchmark/figure data access with caching
- **CISSServiceRegisterBBs** — registers 20+ custom BuildingBlocks with `BBRegistry`
- **XML Workers** — `XMLLoaderWorker`, `XMLConverterWorker`, `XMLPostProcessWorker` handle async XML-to-report processing
- **Machinata integration** — external packages for alternative report rendering (AKB, BLKB, SDG)

**Data layer:** `core/Database/` — CISSDataSource, CISSClientStore, CISSReportStore, CISSResourceStore (all MySQL/MariaDB)
**Models:** `core/Models/Bank/` (Portfolio, Position, Instrument, Issuer, Benchmark) and `core/Models/ESG/` (Figures, currencies, valuations)

### ciss-data-loader (workflow-based)

Entry point: `CissDataLoaderWorkflow.ts` (~545 lines) — uses `WorkflowRunner` + DAG from cinnamon-workflow.

**Key patterns:**
- **File routing** — pattern-matched file dispatch to handlers: fund constituents (ISIN-pattern) → mappers, MSCI files → MsciLoadService, meta CSV → MetaDataLoader, triggers → specialized services
- **Mapper pattern** — `AbstractCissMapper` base class: read → validate → map → store. Concrete: FTSEMapper, BLOOMBERGMapper, AKBMapper, SIXMapper, MSCIMapper + carbon/scope3 variants
- **MsciDownloadService** — SFTP download with RSA host key verification, ZIP extraction, file validation
- **CISSLoaderConfiguration** extends `ServerConfiguration` from cinnamon-server-base + `IClusterProcessConfiguration`
- **MSCIConfiguration** — named `MsciSftpSource[]` sources with trigger override logic
- **Database wrappers** — CISSLoaderDataSourceDB, CISSLoaderClientStoreDB extend `AbstractDatabase`; staging table pattern (load → merge)

**Workflow variables:** `LoaderVariable` type (input/output/processed directories, version)
**File structures:** `FileStructure` type with ISIN, category, dataProvider routing

### ciss-xml-workflow (workflow-based)

Entry point: `XmlWorkflow.ts` (~106 lines) — minimal DAG: waitForTrigger → sendXmlToQueue → moveProcessedFile.

**Key patterns:**
- Uses `waitForFile` from cinnamon-workflow for file monitoring
- Sends `IInboundXmlMessage` to `CISSStreamNames.InboundXmlReceived` via `StreamsRegistry`
- `CissWorkflowConfig` extends `Configuration` from cinnamon-workflow with `workflowDirectory` config
- `IdentificationAssigner` from ciss-base generates unique workflow order IDs

### ciss-base (shared library)

Entry point: `index.ts` — re-exports all public APIs.

**Exports:**
- `CSV/CSVModel.ts` + `CSV/CSVReader.ts` — generic CSV parsing infrastructure (decorated model classes)
- `Messaging/StreamNames.ts` — `CISSStreamNames` constants
- `Messaging/Messages.ts` — `IInboundXmlMessage` interface
- `Types/Common.ts` — `WorkflowDirectory` type
- `Utilities/IdentificationAssigner.ts` — `getUniqueIdForWorkflowOrder()`

## Cross-Package Communication

```
[ciss-xml-workflow] → StreamsRegistry → InboundXmlReceived stream → [ciss-solution XML workers]
[ciss-data-loader] → MariaDB staging tables → merge → shared dataSource DB ← [ciss-solution DataSource]
```

## Development Guidelines

### Before Modifying Any Package
- Check `pnpm-workspace.yaml` catalog for version pins — all cinnamon deps must use `catalog:` references
- Workspace packages use `workspace:` protocol — ciss-base changes affect all consumers
- Run `pnpm compile` at package level to verify TypeScript

### ciss-solution Specific
- Inherits all reporting type guidelines (BuildingBlock patterns, DataSource, caching, API services)
- EsgBB.ts is a 295KB monolith — when modifying, read the specific building block section, not the whole file
- CISSDataSource.ts is 70KB — same advice, target specific methods
- XML worker changes may require coordinating with ciss-xml-workflow message format

### ciss-data-loader Specific
- New data providers need: CSV model class (`Model/`), mapper (`Mapping/`), file handler registration (`Loader/FileHandlers.ts`), workflow routing in `CissDataLoaderWorkflow.ts`
- MSCI configuration uses `MsciSftpSource[]` pattern — add new sources to config, not code
- Staging table pattern: load to staging first, then merge — never write directly to production tables
- Test data files in `test/input/` with expected results in `test/expected/`

### ciss-xml-workflow Specific
- Minimal package — changes here are rare
- Message format changes require coordinating with ciss-solution XML workers
- File monitoring uses cinnamon-workflow's `waitForFile` — don't reimplement

### Shared Filesystem (VM Environment)
- Repo lives on AppleVirtIO shared folder — no git commands from VM
- Always run `sync` after editing files to flush page cache
- User commits from host side only

## Testing

- **ciss-solution:** `jest --maxWorkers=50%` — requires MySQL database
- **ciss-data-loader:** `jest --runInBand` — sequential (shared DB state)
- **ciss-xml-workflow:** `jest --run-in-band --forceExit`
- **ciss-base:** `jest --run-in-band --forceExit`
- Test conventions: `test/*.test.ts`, input data in `test/input/`, expected in `test/expected/`

## Triage Bias

- **Quick track:** Isolated bug fixes in a single mapper, model, or config change
- **Standard track:** New data provider (touches Model + Mapping + FileHandlers + workflow), BuildingBlock changes, DataSource method additions
- **Deep track:** New workflow package, cross-package message format changes, cinnamon-workflow integration patterns, architectural changes to the staging/merge pipeline

## Exploration Checklist

When analyzing a crs-ciss task:
1. Identify which package(s) are affected
2. For ciss-solution: apply parent reporting type checklist
3. For ciss-data-loader/ciss-xml-workflow: check cinnamon-workflow patterns in the sibling repo
4. Check if changes affect cross-package communication (message types in ciss-base)
5. Verify pnpm catalog version compatibility
6. Review related test files before modifying production code
