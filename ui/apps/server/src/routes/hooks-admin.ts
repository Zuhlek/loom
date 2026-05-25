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
  detectInstalledEvents,
  resolveSettingsPath,
  settingsExists,
  DEFAULT_EVENTS,
} from "../hook-installer.ts";
import { getLastDelivered } from "../hook-receiver/index.ts";
import { jsonResponse } from "./_response.ts";

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
  /** Events the installer would wire today (single source of truth). */
  eventsExpected: readonly string[];
  /** Events that currently have a loom-managed entry in settings.json. */
  eventsInstalled: readonly string[];
  /** True iff installed and every expected event is present. */
  healthy: boolean;
  /** @deprecated use eventsExpected — kept for back-compat with older clients. */
  eventsWired: readonly string[];
  installedAt: string | null;
  lastDelivered: { channel: string; at: string } | null;
}

export function buildStatus(opts: HooksAdminOptions): HooksStatus {
  const settingsPath = resolveSettingsPath({ settingsPath: opts.settingsPath });
  const exists = settingsExists({ settingsPath: opts.settingsPath });
  const conflict = detectConflict({ settingsPath: opts.settingsPath });
  const eventsInstalled = detectInstalledEvents({ settingsPath: opts.settingsPath });
  const eventsExpected = [...DEFAULT_EVENTS];
  const installedSet = new Set(eventsInstalled);
  const healthy = conflict.hasMarker && eventsExpected.every((e) => installedSet.has(e));
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
    eventsExpected,
    eventsInstalled,
    healthy,
    eventsWired: eventsExpected,
    installedAt,
    lastDelivered: getLastDelivered(),
  };
}

export function mountHooksAdminRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  opts: HooksAdminOptions,
): void {
  routes["/hooks/status"] = async () => jsonResponse(buildStatus(opts), 200);

  routes["/hooks/install"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    try {
      install({ settingsPath: opts.settingsPath, receiverPort: opts.receiverPort });
      return jsonResponse(buildStatus(opts), 200);
    } catch (err: any) {
      return jsonResponse({ error: err?.message ?? String(err) }, 500);
    }
  };

  routes["/hooks/uninstall"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    try {
      uninstall({ settingsPath: opts.settingsPath });
      return jsonResponse(buildStatus(opts), 200);
    } catch (err: any) {
      return jsonResponse({ error: err?.message ?? String(err) }, 500);
    }
  };

  routes["/hooks/reveal"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const settingsPath = resolveSettingsPath({ settingsPath: opts.settingsPath });
    if (!fs.existsSync(settingsPath)) {
      return jsonResponse({ error: "settings.json not found", settingsPath }, 404);
    }
    try {
      revealInFileManager(settingsPath);
      return jsonResponse({ ok: true, settingsPath }, 200);
    } catch (err: any) {
      return jsonResponse({ error: err?.message ?? String(err) }, 500);
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
