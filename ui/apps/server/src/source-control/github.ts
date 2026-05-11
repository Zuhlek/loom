/*
 * GitHub source-control provider — CLI-based via `gh pr create`.
 *
 * Adapted from t3code's GitHubSourceControlProvider.ts (MIT). t3code uses the
 * REST API directly with auth tokens; for v1 we shell out to `gh` because the
 * user already has it authed (t3code's auth flow is a heavier lift to port).
 */

import { spawn } from "node:child_process";
import type { CreatePrArgs, PrResultMin, SourceControlProvider } from "./index";

export const github: SourceControlProvider = {
  name: "github",
  matches(remoteUrl) {
    return /github\.com[:/]/.test(remoteUrl);
  },
  async createPr(args: CreatePrArgs): Promise<PrResultMin> {
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
    const out = await runCli("gh", flags, args.cwd);
    // `gh pr create` prints the new PR URL on stdout. Extract it.
    const urlMatch = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (!urlMatch) throw new Error(`gh pr create did not return a URL: ${out}`);
    return { url: urlMatch[0]!, number: Number(urlMatch[1]) };
  },
};

function runCli(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}
