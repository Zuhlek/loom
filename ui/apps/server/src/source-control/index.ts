/*
 * Source-control provider registry.
 *
 * Modeled on t3code's SourceControlProviderRegistry.ts (MIT). For nora v1
 * we ship a real GitHub provider (CLI-based) and stub the others — they
 * register a "not implemented yet" placeholder that throws if invoked.
 *
 * The provider is chosen by sniffing the remote URL.
 */

import { github } from "./github";
import { gitlab } from "./gitlab";
import { bitbucket } from "./bitbucket";
import { azureDevOps } from "./azure-devops";

export interface CreatePrArgs {
  cwd: string;
  /** Resolved origin URL, e.g. git@github.com:user/repo.git */
  remoteUrl: string;
  /** Source branch (head of the PR). */
  head: string;
  /** Target branch (PR base). */
  base: string;
  title: string;
  body?: string;
}

export interface PrResultMin {
  url: string;
  number?: number;
}

export interface SourceControlProvider {
  name: string;
  /** True if `remoteUrl` belongs to this provider. */
  matches(remoteUrl: string): boolean;
  /** Open a pull/merge request via CLI or REST. */
  createPr(args: CreatePrArgs): Promise<PrResultMin>;
}

const PROVIDERS: SourceControlProvider[] = [github, gitlab, bitbucket, azureDevOps];

/** Pick the provider that matches `remoteUrl`, throwing if none does. */
export function getProvider(remoteUrl: string): SourceControlProvider {
  const provider = PROVIDERS.find((p) => p.matches(remoteUrl));
  if (!provider) {
    throw new Error(`No source-control provider matches remote URL: ${remoteUrl}`);
  }
  return provider;
}

/** Exported for tests / introspection. */
export function listProviders(): readonly SourceControlProvider[] {
  return PROVIDERS;
}
