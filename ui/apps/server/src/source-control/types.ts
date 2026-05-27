export type SourceControlProviderKind = "github" | "bitbucket";

export interface CreatePrArgs {
  cwd: string;
  remoteUrl: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface PrResult {
  url: string;
  number?: number;
}

export interface ChangeRequest {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  sourceBranch: string;
  targetBranch: string;
  body?: string;
  author?: string;
}

export interface SourceControlProviderShape {
  readonly kind: SourceControlProviderKind;
  matches(remoteUrl: string): boolean;
  createPr(args: CreatePrArgs): Promise<PrResult>;
  listChangeRequests(args: {
    cwd: string;
    state: "open" | "closed" | "all";
    limit?: number;
  }): Promise<ChangeRequest[]>;
  getChangeRequest(args: { cwd: string; reference: string }): Promise<ChangeRequest>;
  checkoutChangeRequest(args: {
    cwd: string;
    reference: string;
  }): Promise<{ branch: string; headSha: string }>;
  pushBranch(args: {
    cwd: string;
    branch: string;
    remote?: string;
    setUpstream?: boolean;
  }): Promise<void>;
  getRepositoryCloneUrls(args: {
    cwd: string;
    repository?: string;
  }): Promise<{ https: string; ssh: string }>;
  createRepository(args: {
    name: string;
    visibility: "public" | "private";
    description?: string;
  }): Promise<{ cloneUrl: string }>;
  getDefaultBranch(args: { cwd: string; repository?: string }): Promise<string>;
}
