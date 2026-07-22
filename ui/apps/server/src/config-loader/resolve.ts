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

/**
 * One selectable Claude model surfaced to the web UI's settings modal.
 * `id` is the identifier passed to the `/model` slash-command literal
 * (an alias like `"opus"` or a full name like `"claude-opus-4-8"`);
 * `label` is the user-facing name.
 */
export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Built-in fallback model catalog. Kept current with the latest Claude
 * family so a fresh install offers a sensible list without any config.
 * Operators can override the whole list via the `models` array in
 * `~/.loom/config.json` (e.g. to pin internal aliases). This is the
 * single source of truth — the web UI renders whatever the server
 * resolves here, so nothing is hardcoded client-side anymore.
 */
export const DEFAULT_MODELS: ReadonlyArray<ModelOption> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

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
  /**
   * Selectable Claude models for the settings modal. Sourced from the
   * config file's `models` array when present + valid; otherwise
   * {@link DEFAULT_MODELS}.
   */
  models: ReadonlyArray<ModelOption>;
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

/**
 * Parse the optional `models` array from config.json. Each entry must
 * be an object with non-empty string `id` + `label`; anything invalid
 * is dropped with a warning. An absent or fully-invalid list falls
 * back to {@link DEFAULT_MODELS} so the modal is never empty.
 */
function parseModels(value: unknown, warnings: string[]): ReadonlyArray<ModelOption> {
  if (value === undefined) return DEFAULT_MODELS;
  if (!Array.isArray(value)) {
    warnings.push(
      `[loom] config.json models is not an array (${JSON.stringify(value)}); using defaults.`,
    );
    return DEFAULT_MODELS;
  }
  const out: ModelOption[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as ModelOption).id === "string" &&
      (entry as ModelOption).id.length > 0 &&
      typeof (entry as ModelOption).label === "string" &&
      (entry as ModelOption).label.length > 0
    ) {
      out.push({ id: (entry as ModelOption).id, label: (entry as ModelOption).label });
    } else {
      warnings.push(`[loom] config.json models entry is invalid; skipping: ${JSON.stringify(entry)}`);
    }
  }
  return out.length > 0 ? out : DEFAULT_MODELS;
}

export function resolveConfig(opts: ResolveOptions = {}): ResolvedConfig {
  const configPath = opts.configPath ?? path.join(os.homedir(), ".loom", "config.json");

  if (opts.cliRoot) {
    return {
      root: opts.cliRoot,
      source: "cli",
      configPath,
      defaultEnvMode: "local",
      models: DEFAULT_MODELS,
    };
  }

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.root === "string" && parsed.root.length > 0) {
        const warnings: string[] = [];
        const defaultEnvMode = parseDefaultEnvMode(parsed.defaultEnvMode, warnings);
        const models = parseModels(parsed.models, warnings);
        for (const w of warnings) console.warn(w);
        return {
          root: parsed.root,
          source: "file",
          worktreesRoot: typeof parsed.worktreesRoot === "string" ? parsed.worktreesRoot : null,
          configPath,
          defaultEnvMode,
          models,
        };
      }
    } catch (err) {
      console.warn(`[loom] config.json is malformed; ignoring: ${(err as Error).message}`);
    }
  }
  // No config file (or file read failure): default to local and surface one
  // warning so the operator is aware the field is unset.
  console.warn(`[loom] config.json missing defaultEnvMode; falling back to "local".`);
  return { root: null, source: "none", configPath, defaultEnvMode: "local", models: DEFAULT_MODELS };
}

export function writeConfig(
  configPath: string,
  payload: { root: string; worktreesRoot?: string; defaultEnvMode?: DefaultEnvMode },
): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), "utf8");
}
