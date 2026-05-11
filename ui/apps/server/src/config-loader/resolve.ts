/**
 * Resolution chain: CLI --root > ~/.loom/config.json > none (wizard).
 *
 * Pure function so it's easy to unit-test.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type ConfigSource = "cli" | "file" | "wizard" | "none";

export interface ResolvedConfig {
  root: string | null;
  source: ConfigSource;
  worktreesRoot?: string | null;
  configPath: string;
}

export interface ResolveOptions {
  cliRoot?: string;
  configPath?: string;
}

export function resolveConfig(opts: ResolveOptions = {}): ResolvedConfig {
  const configPath = opts.configPath ?? path.join(os.homedir(), ".loom", "config.json");

  if (opts.cliRoot) {
    return { root: opts.cliRoot, source: "cli", configPath };
  }

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.root === "string" && parsed.root.length > 0) {
        return {
          root: parsed.root,
          source: "file",
          worktreesRoot: typeof parsed.worktreesRoot === "string" ? parsed.worktreesRoot : null,
          configPath,
        };
      }
    } catch (err) {
      console.warn(`[loom] config.json is malformed; ignoring: ${(err as Error).message}`);
    }
  }
  return { root: null, source: "none", configPath };
}

export function writeConfig(configPath: string, payload: { root: string; worktreesRoot?: string }): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), "utf8");
}
