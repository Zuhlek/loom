// GitHub source-control provider — 8-method implementation via the `gh` CLI.
import * as ghCli from "./gh-cli.ts";
import { executeGit } from "../../git/worktree.ts";
import type {
  ChangeRequest,
  CreatePrArgs,
  PrResult,
  SourceControlProviderShape,
} from "../types.ts";

function mapState(raw: string): ChangeRequest["state"] {
  const s = (raw || "").toLowerCase();
  if (s === "merged") return "merged";
  if (s === "closed") return "closed";
  return "open";
}

function toChangeRequest(raw: any): ChangeRequest {
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title ?? "",
    state: mapState(raw.state),
    sourceBranch: raw.headRefName ?? raw.head?.ref ?? "",
    targetBranch: raw.baseRefName ?? raw.base?.ref ?? "",
    body: raw.body,
    author: raw.author?.login,
  };
}

export const githubProvider: SourceControlProviderShape = {
  kind: "github",
  matches(remoteUrl: string): boolean {
    return /github\.com[:/]/.test(remoteUrl);
  },

  async createPr(args: CreatePrArgs): Promise<PrResult> {
    const flags = [
      "pr",
      "create",
      "--head",
      args.head,
      "--base",
      args.base,
      "--title",
      args.title,
      "--body",
      args.body ?? "",
    ];
    const out = await ghCli.runGh(flags, { cwd: args.cwd });
    const m = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (!m) throw new Error(`gh pr create did not return a URL: ${out}`);
    return { url: m[0]!, number: Number(m[1]) };
  },

  async listChangeRequests(args): Promise<ChangeRequest[]> {
    const stateArg =
      args.state === "all" ? "all" : args.state === "closed" ? "closed" : "open";
    const limit = args.limit ?? 30;
    const fields = "number,url,title,state,headRefName,baseRefName,body,author";
    const out = await ghCli.runGh(
      ["pr", "list", "--state", stateArg, "--limit", String(limit), "--json", fields],
      { cwd: args.cwd },
    );
    const parsed = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed : []).map(toChangeRequest);
  },

  async getChangeRequest(args): Promise<ChangeRequest> {
    const fields = "number,url,title,state,headRefName,baseRefName,body,author";
    const out = await ghCli.runGh(["pr", "view", args.reference, "--json", fields], {
      cwd: args.cwd,
    });
    return toChangeRequest(JSON.parse(out));
  },

  async checkoutChangeRequest(args) {
    await ghCli.runGh(["pr", "checkout", args.reference], { cwd: args.cwd });
    // After `gh pr checkout`, HEAD is on the PR's source branch.
    const branchRes = await executeGit(args.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const shaRes = await executeGit(args.cwd, ["rev-parse", "HEAD"]);
    return { branch: branchRes.stdout.trim(), headSha: shaRes.stdout.trim() };
  },

  async pushBranch(args) {
    const pushArgs = ["push"];
    if (args.setUpstream) pushArgs.push("-u");
    pushArgs.push(args.remote ?? "origin", args.branch);
    await executeGit(args.cwd, pushArgs);
  },

  async getRepositoryCloneUrls(args) {
    const flags = ["repo", "view", "--json", "url,sshUrl"];
    if (args.repository) flags.splice(2, 0, args.repository);
    const out = await ghCli.runGh(flags, { cwd: args.cwd });
    const parsed = JSON.parse(out);
    return { https: parsed.url, ssh: parsed.sshUrl };
  },

  async createRepository(args) {
    const visibilityFlag = args.visibility === "public" ? "--public" : "--private";
    const flags = ["repo", "create", args.name, visibilityFlag, "--json", "url"];
    if (args.description) {
      flags.push("--description", args.description);
    }
    const out = await ghCli.runGh(flags, {});
    const parsed = JSON.parse(out);
    return { cloneUrl: parsed.url };
  },

  async getDefaultBranch(args) {
    const flags = ["repo", "view", "--json", "defaultBranchRef"];
    if (args.repository) flags.splice(2, 0, args.repository);
    const out = await ghCli.runGh(flags, { cwd: args.cwd });
    const parsed = JSON.parse(out);
    return parsed.defaultBranchRef?.name ?? "main";
  },
};
