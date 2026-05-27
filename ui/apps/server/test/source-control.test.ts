import { describe, expect, test } from "vitest";
import { getProvider, listProviders } from "../src/source-control";

describe("source-control provider registry", () => {
  test("matches GitHub URLs (https + ssh)", () => {
    expect(getProvider("https://github.com/user/repo.git")?.kind).toBe("github");
    expect(getProvider("git@github.com:user/repo.git")?.kind).toBe("github");
  });

  test("matches Bitbucket URLs", () => {
    expect(getProvider("https://bitbucket.org/team/repo.git")?.kind).toBe("bitbucket");
  });

  test("returns null for GitLab URLs (out of scope for v1)", () => {
    expect(getProvider("https://gitlab.com/user/repo.git")).toBeNull();
  });

  test("returns null for Azure DevOps URLs (out of scope for v1)", () => {
    expect(getProvider("https://dev.azure.com/org/project/_git/repo")).toBeNull();
    expect(getProvider("https://org.visualstudio.com/_git/repo")).toBeNull();
  });

  test("returns null for unknown URLs (no throw — ADR-006 fallback path)", () => {
    expect(getProvider("https://my-self-hosted.example.com/repo.git")).toBeNull();
  });

  test("bitbucket provider's createPr surfaces a parse error on a malformed remote URL", async () => {
    const provider = getProvider("https://bitbucket.org/team/repo.git")!;
    // The full bitbucket provider is now wired; an empty `remoteUrl`
    // surfaces a structured parse error instead of throwing the legacy
    // "not implemented" sentinel.
    await expect(
      provider.createPr({ cwd: "/", remoteUrl: "", head: "h", base: "main", title: "t" }),
    ).rejects.toThrow(/Cannot parse Bitbucket repository/i);
  });

  test("routed registry exposes github + bitbucket only", () => {
    const kinds = listProviders().map((p) => p.kind);
    expect(kinds).toEqual(["github", "bitbucket"]);
  });
});
