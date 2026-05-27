// Source-control provider registry — routed providers (github + bitbucket) only.
import { githubProvider } from "./github/provider.ts";
import { bitbucketProvider } from "./bitbucket/provider.ts";

export type {
  SourceControlProviderShape,
  SourceControlProviderKind,
  CreatePrArgs,
  PrResult,
  ChangeRequest,
} from "./types.ts";

import type { SourceControlProviderShape } from "./types.ts";

const ROUTED_PROVIDERS: SourceControlProviderShape[] = [githubProvider, bitbucketProvider];

export function getProvider(remoteUrl: string): SourceControlProviderShape | null {
  const provider = ROUTED_PROVIDERS.find((p) => p.matches(remoteUrl));
  return provider ?? null;
}

export function listProviders(): readonly SourceControlProviderShape[] {
  return ROUTED_PROVIDERS;
}
