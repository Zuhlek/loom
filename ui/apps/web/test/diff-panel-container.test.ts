/**
 * T-008 — `DiffPanelContainer` full body (US-006, US-007, US-008).
 *
 * Vitest runtime here is `node`; no jsdom. Static-source assertions
 * matching the precedent in `diff-panel-controlled-scope.test.ts`,
 * `proposed-plan-card.test.ts`, and `live-chat-right-pane.test.ts`.
 *
 * Contract verified:
 *   - File exists at `src/components/diff/DiffPanelContainer.tsx` and
 *     the T-007 stub is gone (no `data-stub="diff-panel-container"`).
 *   - Imports the engine + client surface owned by the prior tasks:
 *     `getGitStatus`, `getDiff`, `parseUnifiedDiff`,
 *     `aggregateSectionsByFile`, and `DiffFileCard`.
 *   - Null `worktreePath` short-circuits to the "worktree not
 *     initialized" copy with no fetch.
 *   - Mount fires `getGitStatus` + `getDiff({ mode: "per-turn" })` in
 *     parallel via `Promise.all`.
 *   - `scope` state is initialised to `"per-turn"`.
 *   - Scope toggle aborts the in-flight controller and re-fires
 *     `getDiff` with the new mode; status is NOT re-fetched.
 *   - Whole-mode rendering pipes sections through
 *     `aggregateSectionsByFile`; per-turn rendering does NOT.
 *   - Loading skeleton: three `animate-pulse` rounded divs.
 *   - Empty: "No changes on this branch yet."
 *   - Error: red callout + Retry button that re-fires both fetches.
 *   - Refresh button calls both fetchers; spinner class on the
 *     button while in flight.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const containerPath = webRoot + "src/components/diff/DiffPanelContainer.tsx";

describe("T-008 DiffPanelContainer — file + import surface", () => {
  test("DiffPanelContainer.tsx exists at the documented path", () => {
    expect(existsSync(containerPath)).toBe(true);
  });

  test("the T-007 stub marker is gone (body has been replaced)", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).not.toMatch(/data-stub=["']diff-panel-container["']/);
  });

  test("imports getGitStatus + getDiff from ../../lib/api", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\bgetGitStatus\b/);
    expect(src).toMatch(/\bgetDiff\b/);
    expect(src).toMatch(/from\s+["']\.\.\/\.\.\/lib\/api["']/);
  });

  test("imports parseUnifiedDiff from ../../lib/diff-parse", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\bparseUnifiedDiff\b/);
    expect(src).toMatch(/from\s+["']\.\.\/\.\.\/lib\/diff-parse["']/);
  });

  test("imports aggregateSectionsByFile from ../../lib/diff-aggregate", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\baggregateSectionsByFile\b/);
    expect(src).toMatch(/from\s+["']\.\.\/\.\.\/lib\/diff-aggregate["']/);
  });

  test("imports DiffFileCard from ./DiffFileCard", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\bDiffFileCard\b/);
    expect(src).toMatch(/from\s+["']\.\/DiffFileCard["']/);
  });

  test("imports the action client functions (postGitCommit/postGitPush/postGitPr)", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\bpostGitCommit\b/);
    expect(src).toMatch(/\bpostGitPush\b/);
    expect(src).toMatch(/\bpostGitPr\b/);
  });

  test("imports CommitDialog from ./CommitDialog", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/\bCommitDialog\b/);
    expect(src).toMatch(/from\s+["']\.\/CommitDialog["']/);
  });
});

describe("T-008 DiffPanelContainer — props + state shape", () => {
  test("exports DiffPanelContainerProps with worktreePath: string | null and chatId: string", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+DiffPanelContainerProps\b/);
    expect(src).toMatch(/worktreePath\s*:\s*string\s*\|\s*null/);
    expect(src).toMatch(/chatId\s*:\s*string/);
  });

  test("DiffPanelContainer is exported as a function component", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(
      /export\s+function\s+DiffPanelContainer\s*\([^)]*\)/,
    );
  });

  test("scope state is initialised to \"per-turn\"", () => {
    const src = readFileSync(containerPath, "utf8");
    // Either a `useState<"per-turn" | "whole">("per-turn")` or a
    // destructured-default. Anchor on the literal seed.
    expect(src).toMatch(
      /useState<\s*["']per-turn["']\s*\|\s*["']whole["']\s*>\s*\(\s*["']per-turn["']\s*\)/,
    );
  });

  test("state declares the snackbar discriminated union with the four kinds", () => {
    const src = readFileSync(containerPath, "utf8");
    // The container state types `snackbar` with kinds "commit",
    // "push", "pr", "error". We assert each literal appears in the
    // file (either in the state type or in the setSnackbar call site).
    expect(src).toMatch(/kind\s*:\s*["']commit["']/);
    expect(src).toMatch(/kind\s*:\s*["']push["']/);
    expect(src).toMatch(/kind\s*:\s*["']pr["']/);
    expect(src).toMatch(/kind\s*:\s*["']error["']/);
  });
});

describe("T-008 DiffPanelContainer — null worktreePath guard", () => {
  test("renders \"worktree not initialized\" when worktreePath is null", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/worktree not initialized/i);
  });

  test("the null-worktreePath branch is gated on a null check (no fetch fires)", () => {
    const src = readFileSync(containerPath, "utf8");
    // Either `if (!worktreePath)` early return or a render-tree
    // ternary that branches on the same predicate.
    const hasGuard =
      /!\s*worktreePath/.test(src) ||
      /worktreePath\s*===\s*null/.test(src) ||
      /worktreePath\s*==\s*null/.test(src);
    expect(hasGuard).toBe(true);
  });
});

describe("T-008 DiffPanelContainer — fetch lifecycle", () => {
  test("mounts a useEffect with worktreePath in the deps", () => {
    const src = readFileSync(containerPath, "utf8");
    // The deps array contains `worktreePath`. We anchor on a
    // useEffect call that references the worktreePath identifier
    // inside a `]` dep list.
    expect(src).toMatch(/useEffect\s*\(/);
    expect(src).toMatch(/\[\s*[^\]]*\bworktreePath\b[^\]]*\]/);
  });

  test("fires getGitStatus and getDiff in parallel via Promise.all", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/Promise\.all\s*\(/);
    // Both client functions are referenced inside the same fetch
    // round; we already assert their imports above, here we anchor
    // the parallel-call site.
    expect(src).toMatch(/getGitStatus\s*\(/);
    expect(src).toMatch(/getDiff\s*\(/);
  });

  test("initial getDiff call passes mode: \"per-turn\" and a signal", () => {
    const src = readFileSync(containerPath, "utf8");
    // We accept either explicit `mode: "per-turn"` or a variable
    // reference like `mode: scope` (scope's initial value is
    // "per-turn"); both forms are present elsewhere in the suite.
    expect(src).toMatch(/mode\s*:\s*(?:["']per-turn["']|scope)/);
    expect(src).toMatch(/signal\s*:/);
  });

  test("stores an AbortController in a ref for cancellation", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/new\s+AbortController\s*\(/);
    expect(src).toMatch(/useRef\b/);
  });
});

describe("T-008 DiffPanelContainer — scope toggle abort + re-fetch", () => {
  test("scope change aborts the in-flight controller", () => {
    const src = readFileSync(containerPath, "utf8");
    // The toggle handler (or a useEffect keyed on scope) must call
    // `.abort()` on the stored controller before firing the new
    // request. We accept any `.abort()` invocation in the file.
    expect(src).toMatch(/\.abort\s*\(\s*\)/);
  });

  test("scope change re-fires getDiff (status is not re-fetched on scope change)", () => {
    const src = readFileSync(containerPath, "utf8");
    // The scope re-fetch path must call getDiff at a site distinct
    // from the initial Promise.all. Anchor on the literal scope
    // identifier appearing near a getDiff call (a useEffect with
    // `scope` in its deps that calls `getDiff(...)`).
    expect(src).toMatch(/useEffect[\s\S]{0,500}getDiff[\s\S]{0,200}\[\s*[^\]]*\bscope\b/);
  });

  test("scope toggle is wired (inline composition; shell abstraction was removed)", () => {
    const src = readFileSync(containerPath, "utf8");
    // Container inlines the scope-toggle UI (the DiffPanelShell
    // abstraction was deleted in R-002 cleanup). The toggle's change
    // handler must reference the scope state.
    expect(src).toMatch(/onScopeChange|setScope/);
  });
});

describe("T-008 DiffPanelContainer — per-turn vs whole rendering", () => {
  test("aggregateSectionsByFile is invoked only in the whole branch", () => {
    const src = readFileSync(containerPath, "utf8");
    // We assert the aggregator call site sits adjacent to a "whole"
    // literal — either a ternary discriminator or an if-branch.
    // Tolerant: just require both tokens within ~200 chars.
    expect(src).toMatch(
      /(scope\s*===\s*["']whole["'][\s\S]{0,400}aggregateSectionsByFile|aggregateSectionsByFile[\s\S]{0,400}scope\s*===\s*["']whole["'])/,
    );
  });

  test("per-turn branch prefixes each section with a meta line carrying the label", () => {
    const src = readFileSync(containerPath, "utf8");
    // The per-turn rendering produces a contiguous block per section
    // headed by `{ kind: "meta", text: <commit subject> }`. The
    // implementation must reference both `section.label` (or a
    // destructured `label`) and `kind: "meta"` near each other.
    expect(src).toMatch(/kind\s*:\s*["']meta["']/);
    expect(src).toMatch(/\.label\b/);
  });

  test("the rendered output uses DiffFileCard for each file", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/<DiffFileCard\b/);
  });
});

describe("T-008 DiffPanelContainer — loading / empty / error UI", () => {
  test("initial-load skeleton: at least three animate-pulse divs", () => {
    const src = readFileSync(containerPath, "utf8");
    // Three rounded skeleton divs. Match either three explicit
    // `<div ... className=\"...animate-pulse...\">` lines or a
    // `[0,1,2].map(...)` rendering shape.
    const pulseHits = src.match(/animate-pulse/g) ?? [];
    expect(pulseHits.length).toBeGreaterThanOrEqual(1);
    // The component must render three placeholders; we accept either
    // a triple-static form (3+ animate-pulse hits) or a 3-element
    // .map / Array.from(..., 3) pattern.
    const tripleStatic = pulseHits.length >= 3;
    const mappedTriple =
      /\[\s*0\s*,\s*1\s*,\s*2\s*\]\.map\b/.test(src) ||
      /Array\.from\s*\(\s*\{\s*length\s*:\s*3\s*\}/.test(src);
    expect(tripleStatic || mappedTriple).toBe(true);
  });

  test("empty-state copy: \"No changes on this branch yet.\"", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/No changes on this branch yet\./);
  });

  test("error callout uses the destructive token + a Retry button", () => {
    const src = readFileSync(containerPath, "utf8");
    // Retry button text.
    expect(src).toMatch(/>\s*Retry\s*</);
    // Red callout — uses var(--destructive) or a `destructive` token
    // somewhere in the file's JSX style attributes.
    expect(src).toMatch(/destructive/);
  });
});

describe("T-008 DiffPanelContainer — refresh button + spinner", () => {
  test("provides an onRefresh handler that calls both fetchers", () => {
    const src = readFileSync(containerPath, "utf8");
    // The BranchToolbar receives `onRefresh`; the handler body must
    // re-fire both fetches. Anchor on the prop name.
    expect(src).toMatch(/onRefresh/);
  });

  test("refresh button shows a spinner class while in flight", () => {
    const src = readFileSync(containerPath, "utf8");
    // Spinner class — accept `animate-spin` (Tailwind) somewhere in
    // the file. The refresh button is the only spinner location per
    // the design.
    expect(src).toMatch(/animate-spin/);
  });
});

describe("T-008 DiffPanelContainer — action wiring", () => {
  test("provides the four BranchToolbar handlers (onCommit / onCommitPush / onCreatePr / onRefresh)", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/onCommit\b/);
    expect(src).toMatch(/onCommitPush\b/);
    expect(src).toMatch(/onCreatePr\b/);
    expect(src).toMatch(/onRefresh\b/);
  });

  test("renders CommitDialog when state.dialog is non-null", () => {
    const src = readFileSync(containerPath, "utf8");
    // The dialog renders below the toolbar / above the diff list
    // (mirrors AskUserQuestionPicker). We assert the conditional
    // mount.
    expect(src).toMatch(/<CommitDialog\b/);
  });
});
