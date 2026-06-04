/**
 * `DiffPanelContainer` static-source contract.
 *
 * Vitest runtime here is `node`; no jsdom. Static-source assertions
 * matching the precedent in the rest of the diff-panel suite.
 *
 * The panel now shows ONE thing: the total branch/workspace diff
 * (`getDiff` → per-repo sections → `buildSectionedFiles`). The legacy
 * turn-based UI (timeline strip, per-turn/whole scope toggle,
 * checkpoint-range fetch) has been removed.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const containerPath = webRoot + "src/components/diff/DiffPanelContainer.tsx";

describe("DiffPanelContainer — file + import surface", () => {
  test("DiffPanelContainer.tsx exists at the documented path", () => {
    expect(existsSync(containerPath)).toBe(true);
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

describe("DiffPanelContainer — turn-based UI is removed", () => {
  test("does NOT import TurnTimelineStrip / getCheckpointDiff / aggregateSectionsByFile", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).not.toMatch(/TurnTimelineStrip/);
    expect(src).not.toMatch(/getCheckpointDiff/);
    expect(src).not.toMatch(/aggregateSectionsByFile/);
  });

  test("no scope/selectedTurn state, no per-turn mode, no scope toggle", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).not.toMatch(/selectedTurn/);
    expect(src).not.toMatch(/onScopeChange/);
    expect(src).not.toMatch(/per-turn/);
    expect(src).not.toMatch(/Whole conversation/);
  });

  test("getDiff is called without a mode argument", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).not.toMatch(/mode\s*:/);
  });
});

describe("DiffPanelContainer — props + state shape", () => {
  test("exports DiffPanelContainerProps with worktreePath: string | null, chatId, refreshSignal", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+DiffPanelContainerProps\b/);
    expect(src).toMatch(/worktreePath\s*:\s*string\s*\|\s*null/);
    expect(src).toMatch(/chatId\s*:\s*string/);
    expect(src).toMatch(/refreshSignal\?\s*:\s*number/);
  });

  test("DiffPanelContainer is exported as a function component", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/export\s+function\s+DiffPanelContainer\s*\([^)]*\)/);
  });

  test("state declares the snackbar discriminated union with the four kinds", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/kind\s*:\s*["']commit["']/);
    expect(src).toMatch(/kind\s*:\s*["']push["']/);
    expect(src).toMatch(/kind\s*:\s*["']pr["']/);
    expect(src).toMatch(/kind\s*:\s*["']error["']/);
  });
});

describe("DiffPanelContainer — fetch lifecycle", () => {
  test("mounts a useEffect with worktreePath in the deps", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/useEffect\s*\(/);
    expect(src).toMatch(/\[\s*[^\]]*\bworktreePath\b[^\]]*\]/);
  });

  test("fires getGitStatus and getDiff in parallel via Promise.all", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/Promise\.all\s*\(/);
    expect(src).toMatch(/getGitStatus\s*\(/);
    expect(src).toMatch(/getDiff\s*\(/);
  });

  test("re-fetches the diff when refreshSignal changes", () => {
    const src = readFileSync(containerPath, "utf8");
    // The signal effect keys on refreshSignal and re-fires the diff fetch.
    expect(src).toMatch(/\[\s*refreshSignal\s*\]/);
  });

  test("stores an AbortController in a ref for cancellation", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/new\s+AbortController\s*\(/);
    expect(src).toMatch(/useRef\b/);
  });
});

describe("DiffPanelContainer — total-diff rendering", () => {
  test("renders via buildSectionedFiles", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/buildSectionedFiles\s*\(/);
  });

  test("labels multi-repo sections with a meta line (root repo shown as '(root)')", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/kind\s*:\s*["']meta["']/);
    expect(src).toMatch(/\(root\)/);
  });

  test("the rendered output uses DiffFileCard for each file", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/<DiffFileCard\b/);
  });
});

describe("DiffPanelContainer — loading / empty / error UI", () => {
  test("initial-load skeleton renders three placeholders", () => {
    const src = readFileSync(containerPath, "utf8");
    const pulseHits = src.match(/animate-pulse/g) ?? [];
    expect(pulseHits.length).toBeGreaterThanOrEqual(1);
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
    expect(src).toMatch(/>\s*Retry\s*</);
    expect(src).toMatch(/destructive/);
  });
});

describe("DiffPanelContainer — refresh + action wiring", () => {
  test("refresh button shows a spinner class while in flight", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/animate-spin/);
  });

  test("provides the four BranchToolbar handlers (onCommit / onCommitPush / onCreatePr / onRefresh)", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/onCommit\b/);
    expect(src).toMatch(/onCommitPush\b/);
    expect(src).toMatch(/onCreatePr\b/);
    expect(src).toMatch(/onRefresh\b/);
  });

  test("renders CommitDialog when state.dialog is non-null", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/<CommitDialog\b/);
  });
});
