/**
 * nora-server entrypoint.
 *
 * Resolves config (CLI > config.json > wizard), acquires the
 * single-instance lockfile, and starts the HTTP+WS server with all
 * routes mounted.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer } from "./http-ws-server.ts";
import { resolveConfig } from "./config-loader/index.ts";
import { initMetadataStore } from "./metadata-store/index.ts";
import { ChatPtyBridge } from "./process-manager/chat-pty-bridge.ts";
import { mountHookReceiver } from "./hook-receiver/index.ts";
import { mountConfigRoute } from "./routes/config.ts";
import { mountSidebarRoute } from "./routes/sidebar.ts";
import { mountCwdRoute } from "./routes/cwd.ts";
import { mountCwdValidateRoute } from "./routes/cwd-validate.ts";
import { mountProjectsRoute } from "./routes/projects.ts";
import { mountChatsRoute } from "./routes/chats.ts";
import { mountDiscoverRoute } from "./routes/discover.ts";
import { mountFileSearchRoute } from "./routes/file-search.ts";
import { mountSlashCommandsRoute } from "./routes/slash-commands.ts";
import { mountUploadImageRoute } from "./routes/upload-image.ts";
import { mountDiffRoute } from "./routes/diff.ts";
import { mountLoomMockupRoute } from "./routes/loom-mockup.ts";
import { mountLoomBoardRoute } from "./routes/loom-board.ts";
import { mountLoomRoute } from "./routes/loom.ts";
import { mountSettingsRoute } from "./routes/settings.ts";

function parseRootFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--root");
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

/**
 * Some node-pty prebuilds ship the spawn-helper without an executable bit.
 * Without that, posix_spawnp fails with no error from libuv. We chmod the
 * helper at startup so the bridge "just works".
 */
function ensureNodePtyHelperExecutable(): void {
  const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Walk up to repo root to find node_modules folders.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) {
      // Direct dependency.
      for (const platform of platforms) {
        const p = path.join(nm, "node-pty", "prebuilds", platform, "spawn-helper");
        chmodIfNotExec(p);
      }
      // pnpm cache layout: .pnpm/node-pty@<version>/node_modules/node-pty/...
      try {
        const pnpmDir = path.join(nm, ".pnpm");
        if (fs.existsSync(pnpmDir)) {
          for (const child of fs.readdirSync(pnpmDir)) {
            if (!child.startsWith("node-pty@")) continue;
            for (const platform of platforms) {
              const p = path.join(
                pnpmDir,
                child,
                "node_modules",
                "node-pty",
                "prebuilds",
                platform,
                "spawn-helper",
              );
              chmodIfNotExec(p);
            }
          }
        }
      } catch {}
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
}

function chmodIfNotExec(p: string): void {
  try {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if ((stat.mode & 0o111) === 0) {
      fs.chmodSync(p, 0o755);
    }
  } catch {}
}

const isEntrypoint =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isEntrypoint) {
  ensureNodePtyHelperExecutable();
  const cliRoot = parseRootFlag(process.argv);
  const config = resolveConfig({ cliRoot });
  const store = await initMetadataStore();
  const bridge = new ChatPtyBridge(store);
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
  mountSlashCommandsRoute(routes);
  mountUploadImageRoute(routes);
  mountDiffRoute(routes);
  mountLoomMockupRoute(routes);
  mountLoomBoardRoute(routes);
  mountLoomRoute(routes, store);
  mountSettingsRoute(routes, config);
  const server = await startServer({
    port: parseInt(process.env.NORA_PORT ?? "3737", 10),
    routes,
    bridge,
  });
  console.log(
    `nora-server listening at ${server.url} (root: ${config.root ?? "<none>"} / source: ${config.source})`,
  );

  const shutdown = async (sig: string) => {
    console.log(`[nora-server] received ${sig}, shutting down...`);
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
