import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProvider,
  listProviders,
  type SourceControlProviderShape,
  type ChangeRequest,
} from "../src/source-control/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");

describe("SourceControlProviderShape registry (T-003)", () => {
  test("getProvider routes github URLs to the github slot", () => {
    const p = getProvider("https://github.com/foo/bar.git");
    expect(p).not.toBeNull();
    expect(p?.kind).toBe("github");
  });

  test("getProvider routes bitbucket URLs to the bitbucket slot", () => {
    const p = getProvider("https://bitbucket.org/foo/bar.git");
    expect(p).not.toBeNull();
    expect(p?.kind).toBe("bitbucket");
  });

  test("getProvider returns null for unknown remotes (ADR-006)", () => {
    // gitlab/azure-devops register kinds beyond github/bitbucket in T-004;
    // T-003 considers them unknown for the routed-verb path.
    const p = getProvider("https://example.invalid/foo/bar.git");
    expect(p).toBeNull();
  });

  test("listProviders exposes github and bitbucket slots at minimum", () => {
    const kinds = listProviders().map((p) => p.kind);
    expect(kinds).toContain("github");
    expect(kinds).toContain("bitbucket");
  });

  test("SourceControlProviderShape exposes all 8 method names (compile-time)", () => {
    const fake: SourceControlProviderShape = {
      kind: "github",
      matches: (_: string) => true,
      createPr: async () => ({ url: "https://x", number: 1 }),
      listChangeRequests: async () => [] as ChangeRequest[],
      getChangeRequest: async () => ({
        number: 1,
        url: "https://x",
        title: "t",
        state: "open",
        sourceBranch: "s",
        targetBranch: "t",
      }),
      checkoutChangeRequest: async () => ({ branch: "b", headSha: "deadbeef" }),
      pushBranch: async () => undefined,
      getRepositoryCloneUrls: async () => ({ https: "https://x", ssh: "git@x" }),
      createRepository: async () => ({ cloneUrl: "https://x" }),
      getDefaultBranch: async () => "main",
    };
    expect(typeof fake.createPr).toBe("function");
    expect(typeof fake.listChangeRequests).toBe("function");
    expect(typeof fake.getChangeRequest).toBe("function");
    expect(typeof fake.checkoutChangeRequest).toBe("function");
    expect(typeof fake.pushBranch).toBe("function");
    expect(typeof fake.getRepositoryCloneUrls).toBe("function");
    expect(typeof fake.createRepository).toBe("function");
    expect(typeof fake.getDefaultBranch).toBe("function");
  });

  test("createPr signature is preserved (back-compat)", async () => {
    // Use the bitbucket stub that still throws but compiles against the
    // widened shape via `createPr(args)`.
    const p = getProvider("https://bitbucket.org/x/y.git");
    expect(p).not.toBeNull();
    // Calling createPr should be a function (will throw "not implemented" at
    // runtime for the stub — T-004 lands the real impl). Type-only test:
    expect(typeof p?.createPr).toBe("function");
  });

  test("worktree.ts does NOT import from source-control/ (US-011 AC10)", () => {
    const wt = fs.readFileSync(
      path.join(serverRoot, "src/git/worktree.ts"),
      "utf8",
    );
    // No `from "../source-control"` or relative variants.
    expect(wt).not.toMatch(/from\s+["'][^"']*source-control[^"']*["']/);
  });
});
