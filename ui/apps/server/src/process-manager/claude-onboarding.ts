/**
 * Pre-set the claude CLI's TUI onboarding flags so the welcome wizard
 * doesn't fire when loom spawns its first chat.
 *
 * Background: the VS Code Claude Code extension launches the same
 * `claude` binary in streaming-JSON mode (no TTY), which skips both
 * the welcome wizard and the trust dialog. A user who has only ever
 * used claude via that extension never completes the TUI onboarding,
 * so `~/.claude.json` has `hasCompletedOnboarding: null`. Loom spawns
 * claude in TUI mode, which then forces the wizard — whose final step
 * is an OAuth login flow that ignores the existing keychain
 * credentials and pops a browser. For users on corporate SSO this
 * round-trip often fails (wrong tenant for Anthropic's Azure app).
 *
 * We only flip `hasCompletedOnboarding` when an `oauthAccount` is
 * already present in `~/.claude.json` — i.e. the user is demonstrably
 * already logged in via some other surface. The per-project trust
 * dialog (`hasTrustDialogAccepted`) is intentionally left alone: that
 * one's a safety gate and should stay user-driven per workspace.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface ClaudeUserConfig {
  oauthAccount?: unknown;
  hasCompletedOnboarding?: boolean;
  theme?: string;
  [key: string]: unknown;
}

export function ensureClaudeOnboarded(configPath?: string): void {
  configPath = configPath ?? path.join(os.homedir(), ".claude.json");

  if (!fs.existsSync(configPath)) {
    // No config at all — user has never run claude on this machine.
    // Let the wizard run as designed; pre-seeding would be presumptuous.
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    console.warn(`[loom] could not read ${configPath}: ${(err as Error).message}`);
    return;
  }

  let config: ClaudeUserConfig;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[loom] ${configPath} is not valid JSON; not pre-setting onboarding: ${(err as Error).message}`,
    );
    return;
  }

  if (!config.oauthAccount) {
    // Not logged in. The wizard's login step is the right path.
    return;
  }

  let dirty = false;
  if (config.hasCompletedOnboarding !== true) {
    config.hasCompletedOnboarding = true;
    dirty = true;
  }
  if (typeof config.theme !== "string" || config.theme.length === 0) {
    config.theme = "dark";
    dirty = true;
  }
  if (!dirty) return;

  try {
    // Preserve original perms (claude writes 0600); fall back to 0600.
    let mode = 0o600;
    try {
      mode = fs.statSync(configPath).mode & 0o777;
    } catch {}
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode });
    console.log(
      "[loom] pre-set claude TUI onboarding flags in ~/.claude.json (skips the welcome wizard for the first chat spawn)",
    );
  } catch (err) {
    console.warn(`[loom] could not write ${configPath}: ${(err as Error).message}`);
  }
}
