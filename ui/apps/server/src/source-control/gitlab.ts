/*
 * GitLab source-control provider — placeholder.
 *
 * Will eventually mirror t3code's GitLabSourceControlProvider.ts (MIT). For v1
 * we register the matcher so URL detection is correct, but throw a clear
 * "not implemented" error if invoked.
 */

import type { SourceControlProvider } from "./index";

export const gitlab: SourceControlProvider = {
  name: "gitlab",
  matches(remoteUrl) {
    return /gitlab\.com[:/]/.test(remoteUrl) || /gitlab\./.test(remoteUrl);
  },
  async createPr() {
    throw new Error("GitLab provider not implemented yet — port from t3code's GitLabSourceControlProvider.ts.");
  },
};
