import { describe, expect, test } from "bun:test";
import { getProvider, listProviders } from "../src/source-control";

describe("source-control provider registry", () => {
  test("matches GitHub URLs (https + ssh)", () => {
    expect(getProvider("https://github.com/user/repo.git").name).toBe("github");
    expect(getProvider("git@github.com:user/repo.git").name).toBe("github");
  });

  test("matches GitLab URLs", () => {
    expect(getProvider("https://gitlab.com/user/repo.git").name).toBe("gitlab");
    expect(getProvider("git@gitlab.example.com:user/repo.git").name).toBe("gitlab");
  });

  test("matches Bitbucket URLs", () => {
    expect(getProvider("https://bitbucket.org/team/repo.git").name).toBe("bitbucket");
  });

  test("matches Azure DevOps URLs", () => {
    expect(getProvider("https://dev.azure.com/org/project/_git/repo").name).toBe("azure-devops");
    expect(getProvider("https://org.visualstudio.com/_git/repo").name).toBe("azure-devops");
  });

  test("throws for unknown URLs", () => {
    expect(() => getProvider("https://my-self-hosted.example.com/repo.git")).toThrow();
  });

  test("placeholder providers throw a descriptive 'not implemented' error", async () => {
    const gitlab = listProviders().find((p) => p.name === "gitlab")!;
    await expect(
      gitlab.createPr({ cwd: "/", remoteUrl: "", head: "h", base: "main", title: "t" }),
    ).rejects.toThrow(/not implemented/);
  });

  test("registry exposes 4 providers", () => {
    const names = listProviders().map((p) => p.name);
    expect(names).toEqual(["github", "gitlab", "bitbucket", "azure-devops"]);
  });
});
