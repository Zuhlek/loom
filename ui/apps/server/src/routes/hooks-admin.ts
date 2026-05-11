/**
 * GET  /hooks/status     — installer state + live diagnostics for the Settings → Hooks panel.
 * POST /hooks/install    — install loom's marker block; returns the updated status.
 * POST /hooks/uninstall  — remove loom's marker block; returns the updated status.
 * POST /hooks/reveal     — reveal ~/.claude/settings.json in the OS file manager.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  install,
  uninstall,
  detectConflict,
  resolveSettingsPath,
  settingsExists,
} from "../hook-installer.ts";
import { getLastDelivered } from "../hook-receiver/index.ts";

const WIRED_EVENTS = ["PostToolUse", "SessionStart", "Stop", "SubagentStop", "PermissionRequest"];

export interface HooksAdminOptions {
  /** Receiver port that install() writes into the hook commands. */
  receiverPort: number;
  /** Override settings.json path (tests only). */
  settingsPath?: string;
}

export interface HooksStatus {
  settingsPath: string;
  settingsExists: boolean;
  installed: boolean;
  hasMarker: boolean;
  hasUserHooks: boolean;
  receiverPort: number;
  eventsWired: readonly string[];
  installedAt: string | null;
  lastDelivered: { channel: string; at: string } | null;
}

function buildStatus(opts: HooksAdminOptions): HooksStatus {
  const settingsPath = resolveSettingsPath({ settingsPath: opts.settingsPath });
  const exists = settingsExists({ settingsPath: opts.settingsPath });
  const conflict = detectConflict({ settingsPath: opts.settingsPath });
  let installedAt: string | null = null;
  if (exists && conflict.hasMarker) {
    try {
      installedAt = fs.statSync(settingsPath).mtime.toISOString();
    } catch {}
  }
  return {
    settingsPath,
    settingsExists: exists,
    installed: conflict.hasMarker,
    hasMarker: conflict.hasMarker,
    hasUserHooks: conflict.hasUserHooks,
    receiverPort: opts.receiverPort,
    eventsWired: WIRED_EVENTS,
    installedAt,
    lastDelivered: getLastDelivered(),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mountHooksAdminRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  opts: HooksAdminOptions,
): void {
  routes["/hooks/status"] = async () => json(200, buildStatus(opts));

  routes["/hooks/install"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    try {
      install({ settingsPath: opts.settingsPath, receiverPort: opts.receiverPort });
      return json(200, buildStatus(opts));
    } catch (err: any) {
      return json(500, { error: err?.message ?? String(err) });
    }
  };

  routes["/hooks/uninstall"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    try {
      uninstall({ settingsPath: opts.settingsPath });
      return json(200, buildStatus(opts));
    } catch (err: any) {
      return json(500, { error: err?.message ?? String(err) });
    }
  };

  routes["/hooks/reveal"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const settingsPath = resolveSettingsPath({ settingsPath: opts.settingsPath });
    if (!fs.existsSync(settingsPath)) {
      return json(404, { error: "settings.json not found", settingsPath });
    }
    try {
      revealInFileManager(settingsPath);
      return json(200, { ok: true, settingsPath });
    } catch (err: any) {
      return json(500, { error: err?.message ?? String(err) });
    }
  };
}

function revealInFileManager(filePath: string): void {
  if (process.platform === "darwin") {
    spawn("open", ["-R", filePath], { stdio: "ignore", detached: true }).unref();
  } else if (process.platform === "win32") {
    spawn("explorer.exe", [`/select,${filePath}`], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [path.dirname(filePath)], { stdio: "ignore", detached: true }).unref();
  }
}
