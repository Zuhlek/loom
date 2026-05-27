// Bitbucket source-control provider — 8-method implementation via REST API.
import { bbFetch, repositoryFromRemote } from "./api.ts";
import { executeGit } from "../../git/worktree.ts";
import type {
  ChangeRequest,
  CreatePrArgs,
  PrResult,
  SourceControlProviderShape,
} from "../types.ts";

function mapState(raw: string): ChangeRequest["state"] {
  const s = (raw || "").toUpperCase();
  if (s === "MERGED") return "merged";
  if (s === "DECLINED" || s === "CLOSED" || s === "SUPERSEDED") return "closed";
  return "open";
}

function toChangeRequest(raw: any): ChangeRequest {
  return {
    number: raw.id,
    url: raw.links?.html?.href ?? "",
    title: raw.title ?? "",
    state: mapState(raw.state),
    sourceBranch: raw.source?.branch?.name ?? "",
    targetBranch: raw.destination?.branch?.name ?? "",
    body: raw.description,
    author: raw.author?.display_name,
  };
}

function remoteToRepo(remoteUrl: string, override?: string): string {
  if (override) return override;
  const repo = repositoryFromRemote(remoteUrl);
  if (!repo) throw new Error(`Cannot parse Bitbucket repository from ${remoteUrl}`);
  return repo;
}

async function inferRepoFromCwd(cwd: string, override?: string): Promise<string> {
  if (override) return override;
  const res = await executeGit(cwd, ["remote", "get-url", "origin"]);
  const repo = repositoryFromRemote(res.stdout.trim());
  if (!repo) throw new Error(`Cannot infer Bitbucket repository from cwd ${cwd}`);
  return repo;
}

export const bitbucketProvider: SourceControlProviderShape = {
  kind: "bitbucket",
  matches(remoteUrl: string): boolean {
    return /bitbucket\.org[:/]/.test(remoteUrl);
  },

  async createPr(args: CreatePrArgs): Promise<PrResult> {
    const repo = remoteToRepo(args.remoteUrl);
    const created = await bbFetch<any>(`/repositories/${repo}/pullrequests`, {
      method: "POST",
      body: {
        title: args.title,
        description: args.body ?? "",
        source: { branch: { name: args.head } },
        destination: { branch: { name: args.base } },
      },
    });
    return {
      url: created.links?.html?.href ?? "",
      number: created.id,
    };
  },

  async listChangeRequests(args) {
    const repo = await inferRepoFromCwd(args.cwd);
    const state =
      args.state === "all"
        ? ""
        : args.state === "closed"
        ? "&state=DECLINED&state=MERGED"
        : "&state=OPEN";
    const limit = args.limit ?? 30;
    const data = await bbFetch<any>(
      `/repositories/${repo}/pullrequests?pagelen=${limit}${state}`,
    );
    return (data.values ?? []).map(toChangeRequest);
  },

  async getChangeRequest(args) {
    const repo = await inferRepoFromCwd(args.cwd);
    const data = await bbFetch<any>(`/repositories/${repo}/pullrequests/${args.reference}`);
    return toChangeRequest(data);
  },

  async checkoutChangeRequest(args) {
    const repo = await inferRepoFromCwd(args.cwd);
    const data = await bbFetch<any>(`/repositories/${repo}/pullrequests/${args.reference}`);
    const branch: string = data.source?.branch?.name ?? "";
    const headSha: string = data.source?.commit?.hash ?? "";
    if (!branch) throw new Error(`Bitbucket PR ${args.reference} has no source branch`);
    await executeGit(args.cwd, ["fetch", "origin", branch]);
    await executeGit(args.cwd, ["checkout", branch]);
    return { branch, headSha };
  },

  async pushBranch(args) {
    const pushArgs = ["push"];
    if (args.setUpstream) pushArgs.push("-u");
    pushArgs.push(args.remote ?? "origin", args.branch);
    await executeGit(args.cwd, pushArgs);
  },

  async getRepositoryCloneUrls(args) {
    const repo = args.repository ?? (await inferRepoFromCwd(args.cwd));
    const data = await bbFetch<any>(`/repositories/${repo}`);
    const clones: { name: string; href: string }[] = data.links?.clone ?? [];
    const https = clones.find((c) => c.name === "https")?.href ?? "";
    const ssh = clones.find((c) => c.name === "ssh")?.href ?? "";
    return { https, ssh };
  },

  async createRepository(args) {
    const user = process.env.BITBUCKET_USERNAME ?? "";
    const data = await bbFetch<any>(`/repositories/${user}/${args.name}`, {
      method: "POST",
      body: {
        scm: "git",
        is_private: args.visibility === "private",
        description: args.description ?? "",
      },
    });
    const clones: { name: string; href: string }[] = data.links?.clone ?? [];
    return { cloneUrl: clones.find((c) => c.name === "https")?.href ?? "" };
  },

  async getDefaultBranch(args) {
    const repo = args.repository ?? (await inferRepoFromCwd(args.cwd));
    const data = await bbFetch<any>(`/repositories/${repo}`);
    return data.mainbranch?.name ?? "main";
  },
};
