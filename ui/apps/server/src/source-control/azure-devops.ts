/*
 * Azure DevOps source-control provider — placeholder.
 *
 * Will eventually mirror t3code's AzureDevOpsSourceControlProvider.ts (MIT).
 */

import type { SourceControlProvider } from "./index";

export const azureDevOps: SourceControlProvider = {
  name: "azure-devops",
  matches(remoteUrl) {
    return /dev\.azure\.com/.test(remoteUrl) || /\.visualstudio\.com/.test(remoteUrl);
  },
  async createPr() {
    throw new Error("Azure DevOps provider not implemented yet — port from t3code's AzureDevOpsSourceControlProvider.ts.");
  },
};
