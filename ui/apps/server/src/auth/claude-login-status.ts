/**
 * Best-effort `claude /login` status probe.
 *
 * Reads ~/.claude/.credentials.json (Claude Code's CLI auth artifact)
 * and returns whether the user appears logged in. Plan.md mandates
 * rejecting ANTHROPIC_API_KEY if set in env.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface LoginStatus {
  loggedIn: boolean;
  apiKeyDetected: boolean;
  apiKeyRejected: boolean;
  message?: string;
}

export function getClaudeLoginStatus(): LoginStatus {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiKeyDetected = !!apiKey && apiKey.length > 0;
  // Per plan.md "Security & compliance" — API key auth is rejected.
  const apiKeyRejected = apiKeyDetected;
  const credPaths = [
    path.join(os.homedir(), ".claude", ".credentials.json"),
    path.join(os.homedir(), ".claude", "credentials.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", ".credentials.json"),
  ];
  let loggedIn = false;
  for (const p of credPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.access_token || parsed.token || parsed.refresh_token)) {
          loggedIn = true;
          break;
        }
      } catch {}
    }
  }
  return {
    loggedIn,
    apiKeyDetected,
    apiKeyRejected,
    message: apiKeyDetected
      ? "ANTHROPIC_API_KEY detected in env; API key auth is disabled. Use `claude /login` instead."
      : undefined,
  };
}
