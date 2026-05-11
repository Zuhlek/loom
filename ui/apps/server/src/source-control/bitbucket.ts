/*
 * Bitbucket source-control provider — placeholder.
 *
 * Will eventually mirror t3code's BitbucketSourceControlProvider.ts (MIT).
 */

import type { SourceControlProvider } from "./index";

export const bitbucket: SourceControlProvider = {
  name: "bitbucket",
  matches(remoteUrl) {
    return /bitbucket\.org[:/]/.test(remoteUrl);
  },
  async createPr() {
    throw new Error("Bitbucket provider not implemented yet — port from t3code's BitbucketSourceControlProvider.ts.");
  },
};
