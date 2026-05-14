/**
 * loom-server entrypoint.
 *
 * Resolves config (CLI > config.json > wizard), acquires the
 * single-instance lockfile, and starts the HTTP+WS server with all
 * routes mounted.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "./http-ws-server.ts";
import { resolveConfig } from "./config-loader/index.ts";
import { initMetadataStore } from "./metadata-store/index.ts";
import { ClaudeSessionBridge } from "./process-manager/claude-session-bridge.ts";
import { ensureClaudeOnboarded } from "./process-manager/claude-onboarding.ts";
import { mountHookReceiver } from "./hook-receiver/index.ts";
import { mountConfigRoute } from "./routes/config.ts";
import { mountSidebarRoute } from "./routes/sidebar.ts";
import { mountCwdRoute } from "./routes/cwd.ts";
import { mountCwdValidateRoute } from "./routes/cwd-validate.ts";
import { mountProjectsRoute } from "./routes/projects.ts";
import { mountChatsRoute } from "./routes/chats.ts";
import { mountDiscoverRoute } from "./routes/discover.ts";
import { mountFileSearchRoute } from "./routes/file-search.ts";
import { mountUploadImageRoute } from "./routes/upload-image.ts";
import { mountDiffRoute } from "./routes/diff.ts";
import { mountGitStatusRoute } from "./routes/git-status.ts";
import { mountGitActionsRoute } from "./routes/git-actions.ts";
import { mountFabricMockupRoute } from "./routes/fabric-mockup.ts";
import { mountFabricBoardRoute } from "./routes/fabric-board.ts";
import { mountFabricRoute } from "./routes/fabric.ts";
import { mountFabricArchiveRoute } from "./routes/fabric-archive.ts";
import { mountSettingsRoute } from "./routes/settings.ts";
import { mountHooksAdminRoute } from "./routes/hooks-admin.ts";

function parseRootFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--root");
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

function isExecutableFile(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function findOnPath(name: string): string | null {
  const PATH = process.env.PATH ?? "";
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function compareSemverDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolve the claude binary. Order:
 *   1. $LOOM_CLAUDE_BIN (explicit override)
 *   2. `claude` on $PATH
 *   3. ~/.claude/local/claude (official local installer)
 *   4. Newest VS Code extension bundle: ~/.vscode/extensions/anthropic.claude-code-*<platform>/resources/native-binary/claude
 * Falls back to bare "claude" so we still surface a clean error if nothing works.
 */
function resolveClaudeBin(): string {
  const env = process.env.LOOM_CLAUDE_BIN;
  if (env) {
    if (isExecutableFile(env)) return env;
    console.warn(`[loom] LOOM_CLAUDE_BIN=${env} is not an executable file; ignoring.`);
  }

  const onPath = findOnPath("claude");
  if (onPath) return onPath;

  const local = path.join(os.homedir(), ".claude", "local", "claude");
  if (isExecutableFile(local)) return local;

  try {
    const extDir = path.join(os.homedir(), ".vscode", "extensions");
    if (fs.existsSync(extDir)) {
      const matches = fs
        .readdirSync(extDir)
        .filter((name) => name.startsWith("anthropic.claude-code-"))
        .map((name) => {
          // anthropic.claude-code-<version>-<platform>
          const rest = name.slice("anthropic.claude-code-".length);
          const dash = rest.indexOf("-");
          const version = dash >= 0 ? rest.slice(0, dash) : rest;
          return { name, version };
        })
        .sort((a, b) => compareSemverDesc(a.version, b.version));
      for (const m of matches) {
        const candidate = path.join(extDir, m.name, "resources", "native-binary", "claude");
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  } catch {}

  return "claude";
}

const isEntrypoint =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isEntrypoint) {
  ensureClaudeOnboarded();
  const cliRoot = parseRootFlag(process.argv);
  const config = resolveConfig({ cliRoot });
  const store = await initMetadataStore();
  const claudeBin = resolveClaudeBin();
  console.log(`[loom] using claude binary: ${claudeBin}`);
  const bridge = new ClaudeSessionBridge(store, { pathToClaudeCodeExecutable: claudeBin });
  const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
  mountHookReceiver(routes, store);
  mountConfigRoute(routes, config);
  mountSidebarRoute(routes, store);
  mountCwdRoute(routes, store);
  mountCwdValidateRoute(routes);
  mountProjectsRoute(routes, store, bridge);
  mountChatsRoute(routes, store, bridge);
  mountDiscoverRoute(routes);
  mountFileSearchRoute(routes);
  mountUploadImageRoute(routes);
  mountDiffRoute(routes);
  mountGitStatusRoute(routes);
  mountGitActionsRoute(routes);
  mountFabricMockupRoute(routes);
  mountFabricBoardRoute(routes);
  mountFabricRoute(routes, store);
  mountFabricArchiveRoute(routes, store);
  mountSettingsRoute(routes, config);
  const loomPort = parseInt(process.env.LOOM_PORT ?? "3737", 10);
  mountHooksAdminRoute(routes, { receiverPort: loomPort });
  const server = await startServer({
    port: loomPort,
    routes,
    bridge,
  });
  console.log(
    `loom-server listening at ${server.url} (root: ${config.root ?? "<none>"} / source: ${config.source})`,
  );

  const shutdown = async (sig: string) => {
    console.log(`[loom-server] received ${sig}, shutting down...`);
    try {
      await server.stop();
    } catch {}
    try {
      await store.close();
    } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
