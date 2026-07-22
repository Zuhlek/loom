/**
 * Resolution chain: CLI --root > ~/.loom/config.json > none (wizard).
 *
 * Pure function so it's easy to unit-test.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type ConfigSource = "cli" | "file" | "wizard" | "none";

export type DefaultEnvMode = "local" | "worktree";

export interface ResolvedConfig {
  root: string | null;
  source: ConfigSource;
  worktreesRoot?: string | null;
  configPath: string;
  /**
   * Resolved env-mode that first-send applies when the chat has no
   * committed `worktree_mode` yet. Default is `"local"` — missing or
   * malformed `defaultEnvMode` values fall back to `"local"` and emit
   * one warning at resolve time.
   */
  defaultEnvMode: DefaultEnvMode;
}

export interface ResolveOptions {
  cliRoot?: string;
  configPath?: string;
}

function parseDefaultEnvMode(value: unknown, warnings: string[]): DefaultEnvMode {
  if (value === "local" || value === "worktree") return value;
  if (value !== undefined) {
    warnings.push(
      `[loom] config.json defaultEnvMode is invalid (${JSON.stringify(value)}); falling back to "local".`,
    );
  } else {
    warnings.push(`[loom] config.json missing defaultEnvMode; falling back to "local".`);
  }
  return "local";
}

export function resolveConfig(opts: ResolveOptions = {}): ResolvedConfig {
  const configPath = opts.configPath ?? path.join(os.homedir(), ".loom", "config.json");

  if (opts.cliRoot) {
    return { root: opts.cliRoot, source: "cli", configPath, defaultEnvMode: "local" };
  }

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.root === "string" && parsed.root.length > 0) {
        const warnings: string[] = [];
        const defaultEnvMode = parseDefaultEnvMode(parsed.defaultEnvMode, warnings);
        for (const w of warnings) console.warn(w);
        return {
          root: parsed.root,
          source: "file",
          worktreesRoot: typeof parsed.worktreesRoot === "string" ? parsed.worktreesRoot : null,
          configPath,
          defaultEnvMode,
        };
      }
    } catch (err) {
      console.warn(`[loom] config.json is malformed; ignoring: ${(err as Error).message}`);
    }
  }
  // No config file (or file read failure): default to local and surface one
  // warning so the operator is aware the field is unset.
  console.warn(`[loom] config.json missing defaultEnvMode; falling back to "local".`);
  return { root: null, source: "none", configPath, defaultEnvMode: "local" };
}

