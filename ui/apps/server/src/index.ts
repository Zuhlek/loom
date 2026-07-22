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
import { resolveConfig, type ResolvedConfig } from "./config-loader/index.ts";
import { initMetadataStore, type MetadataStore } from "./metadata-store/index.ts";
import { createJsonlTailBridge, type JsonlTailBridge } from "./process-manager/jsonl/bridge.ts";
import { createImageStore, type ImageStore } from "./process-manager/jsonl/image-store.ts";
import { createTmuxSession } from "./process-manager/tmux-session.ts";
import {
  probeTmux,
} from "./process-manager/tmux-availability.ts";
import { createSessionIdStore } from "./process-manager/session-store.ts";
import { createPaneProcessApi } from "./process-manager/pane-process.ts";
import { ensureFolderTrusted } from "./process-manager/folder-trust.ts";
import { ensureClaudeOnboarded } from "./process-manager/claude-onboarding.ts";
import { mountHookReceiver, setEnvelopeBroadcaster } from "./hook-receiver/index.ts";
import { createPermissionGate, type PermissionGate } from "./hook-receiver/permission-gate.ts";
import { mountConfigRoute } from "./routes/config.ts";
import { mountSidebarRoute } from "./routes/sidebar.ts";
import { mountCwdRoute } from "./routes/cwd.ts";
import { mountCwdValidateRoute } from "./routes/cwd-validate.ts";
import { mountProjectsRoute } from "./routes/projects.ts";
import { mountChatsRoute } from "./routes/chats.ts";
import { mountFileSearchRoute } from "./routes/file-search.ts";
import { mountUploadImageRoute } from "./routes/upload-image.ts";
import { mountChatImageRoute } from "./routes/chat-image.ts";
import { mountDiffRoute } from "./routes/diff.ts";
import { mountGitStatusRoute } from "./routes/git-status.ts";
import { mountGitActionsRoute } from "./routes/git-actions.ts";
import { mountFabricMockupRoute } from "./routes/fabric-mockup.ts";
import { mountFabricRoute } from "./routes/fabric.ts";
import { mountFabricArchiveRoute } from "./routes/fabric-archive.ts";
import { mountSettingsRoute } from "./routes/settings.ts";
import { mountChatsMetaRoute } from "./routes/chats-meta.ts";
import { mountGitVerbsRoute } from "./routes/git-verbs.ts";
import { mountGitWorktreeRoute } from "./routes/git-worktree.ts";
import { mountWorktreesRoute } from "./routes/worktrees.ts";
import { mountSourceControlRoute } from "./routes/source-control-rpc.ts";
import { mountHooksAdminRoute, buildStatus as buildHooksStatus } from "./routes/hooks-admin.ts";
import { createCheckpointStore, type CheckpointStore } from "./checkpointing/checkpoint-store.ts";
import {
  createCheckpointReactor,
  type CheckpointReactor,
} from "./checkpointing/checkpoint-reactor.ts";
import { createHeadWatcher, type HeadWatcher } from "./git/head-watcher.ts";
import { reconcileGitContextOnAttach } from "./process-manager/reconcile-git-context.ts";
import { runFirstSendHook } from "./process-manager/first-send-hook.ts";
import type { ServerFrame } from "./chat-protocol/frames.ts";

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
export function resolveClaudeBin(): string {
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

export interface ChatDiffPanelSubstrate {
  checkpointStore: CheckpointStore;
  reactor: CheckpointReactor;
  headWatcher: HeadWatcher;
  /** Per-chat assistant-turn counter; reset to 0 on (re-)attach. */
  turnCounters: Map<string, number>;
  headWatcherSubscription: { unsubscribe(): void } | null;
}

export function createChatDiffPanelSubstrate(
  bridge: JsonlTailBridge,
  config: ResolvedConfig,
): ChatDiffPanelSubstrate {
  const broadcastAll = (frame: ServerFrame) => bridge.broadcastFrameToAll(frame);
  const broadcastChat = (chatId: string, frame: ServerFrame) =>
    bridge.broadcastFrameToChat(chatId, frame);

  const checkpointStore = createCheckpointStore();
  const reactor = createCheckpointReactor({
    store: checkpointStore,
    emit: (frame) => {
      if (frame.kind === "checkpoint-captured") {
        broadcastChat(frame["chat-id"], frame);
      } else {
        broadcastAll(frame);
      }
    },
  });
  const headWatcher = createHeadWatcher({
    emit: (frame) => broadcastAll(frame),
  });
  const turnCounters = new Map<string, number>();

  let headWatcherSubscription: { unsubscribe(): void } | null = null;
  if (config.root) {
    try {
      headWatcherSubscription = headWatcher.watch(config.root);
    } catch (err) {
      console.warn(`[loom] head-watcher failed to attach to ${config.root}: ${(err as Error).message}`);
    }
  }

  return {
    checkpointStore,
    reactor,
    headWatcher,
    turnCounters,
    headWatcherSubscription,
  };
}

export interface MountAllRoutesDeps {
  store: MetadataStore;
  config: ResolvedConfig;
  bridge: JsonlTailBridge;
  substrate: ChatDiffPanelSubstrate;
  receiverPort: number;
  sessionStore: ReturnType<typeof createSessionIdStore>;
  imageStore: ImageStore;
  /**
   * Permission gate shared with the bridge. When present, gated PreToolUse
   * hooks block on the loom popup; when omitted the receiver acks immediately
   * (claude defers to its own permission flow).
   */
  permissionGate?: PermissionGate;
}

export function mountAllRoutes(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  deps: MountAllRoutesDeps,
): void {
  const { store, config, bridge, substrate, receiverPort, sessionStore, imageStore, permissionGate } = deps;
  const broadcastAll = (frame: ServerFrame) => bridge.broadcastFrameToAll(frame);

  mountHookReceiver(routes, store, sessionStore, permissionGate);
  mountConfigRoute(routes, config);
  mountSidebarRoute(routes, store, bridge);
  mountCwdRoute(routes, store);
  mountCwdValidateRoute(routes);
  mountProjectsRoute(routes, store, bridge);
  mountChatsRoute(routes, store, bridge);
  mountFileSearchRoute(routes);
  mountUploadImageRoute(routes);
  mountChatImageRoute(routes, imageStore);
  mountDiffRoute(routes);
  mountGitStatusRoute(routes);
  mountGitActionsRoute(routes);
  mountFabricMockupRoute(routes);
  mountFabricRoute(routes, store);
  mountFabricArchiveRoute(routes, store);
  mountSettingsRoute(routes, config);
  mountHooksAdminRoute(routes, { receiverPort });
  mountChatsMetaRoute(routes, store, broadcastAll);
  mountGitVerbsRoute(routes, store, broadcastAll);
  mountGitWorktreeRoute(routes, store, broadcastAll);
  mountWorktreesRoute(routes, store, config.root ?? process.cwd(), broadcastAll);
  mountSourceControlRoute(routes, store, broadcastAll);
}

const isEntrypoint =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isEntrypoint) {
  ensureClaudeOnboarded();
  const cliRoot = parseRootFlag(process.argv);
  const config = resolveConfig({ cliRoot });
  const store = await initMetadataStore();
  // Durable per-chat image store. Uses the same `~/.loom` data-dir convention
  // as the metadata store. Injected into the bridge (staging side) and the
  // /chat-image route + materializer resolver (read-back side).
  const imageStore = createImageStore();
  const claudeBin = resolveClaudeBin();
  console.log(`[loom] using claude binary: ${claudeBin}`);

  // JsonlTailBridge is the only bridge after the cutover. The
  // pre-cutover SDK bridge and the `LOOM_BRIDGE` env switch are
  // deleted. License posture: zero `claude-agent-sdk` dependency
  // in `ui/`.
  //
  // Lazy tmux probe: the server must boot in environments where tmux
  // isn't installed yet so the UI can render a setup banner. The probe
  // never throws; we cache its result and wire an `availability` getter
  // into `createTmuxSession`. The UI surfaces missing-tmux through
  // typed runtime-unavailable error frames at first chat-attach
  // (`jsonl/bridge.ts`).
  const tmuxProbe = await probeTmux();
  if (!tmuxProbe.available) {
    // `probeTmux` attaches the install hint (docs/setup.md) to versionError.
    console.warn(`[loom] ${tmuxProbe.versionError ?? "tmux: unavailable."}`);
  } else if (tmuxProbe.version) {
    console.log(`[loom] tmux probe: ${tmuxProbe.version}`);
  }
  const tmux = createTmuxSession({
    claudeBin,
    availability: () => ({ available: tmuxProbe.available }),
  });
  const sessionStore = createSessionIdStore({
    storagePath: path.join(os.homedir(), ".claude", "loom", "session-id-store.json"),
  });
  // Substrate-back-reference holder. The bridge needs lifecycle hooks
  // that touch the substrate; the substrate needs the bridge for
  // broadcast. Construct the bridge first with a deferred substrate
  // pointer, then assign once both are alive.
  let substrateRef: ChatDiffPanelSubstrate | null = null;

  // Shared permission gate: the hook receiver registers + awaits gates here
  // (holding gated PreToolUse curls open) and the bridge resolves them from
  // WS permission-responses. One instance bridges both halves.
  const permissionGate = createPermissionGate();

  const bridge = createJsonlTailBridge({
    tmux,
    sessionStore,
    tailRoot: path.join(os.homedir(), ".claude", "projects"),
    permissionGate,
    imageStore,
    paneProcess: createPaneProcessApi(),
    cwdResolver: async (chatId: string) => {
      const chat = store.chats.get(chatId);
      return chat?.cwd ?? process.cwd();
    },
    // Record folder trust before a Full-access spawn so claude's
    // --dangerously-skip-permissions trust dialog never blocks the pane
    // (folder-trust.ts). Bridge calls this for bypassPermissions only.
    ensureFolderTrusted: (cwd: string) => {
      ensureFolderTrusted(cwd);
    },
    permissionModeResolver: (chatId: string) => {
      const chat = store.chats.get(chatId);
      return chat?.permission_mode ?? "default";
    },
    persistPermissionMode: (chatId, mode) => {
      return store.chats.update(chatId, { permission_mode: mode });
    },
    onChatAttach: (chatId, cwd) => {
      if (!substrateRef) return;
      try {
        // Self-heal git context frozen by a transient mount fault, and push
        // any correction to the live client (a reload picks it up from the
        // now-corrected row).
        const git = reconcileGitContextOnAttach(store, chatId);
        if (git.vcsChanged) {
          bridge.broadcastFrameToChat(chatId, {
            kind: "chat-meta-changed",
            "chat-id": chatId,
            body: { vcsKind: git.vcsKind, repoName: git.repoName },
          });
        }
        if (git.branchChanged && git.branch !== null) {
          bridge.broadcastFrameToChat(chatId, {
            kind: "ref-change",
            "chat-id": chatId,
            body: { cwd, branch: git.branch },
          });
        }
      } catch (err) {
        console.warn(`[loom] reconcileGitContextOnAttach failed for ${chatId}: ${(err as Error).message}`);
      }
      substrateRef.turnCounters.set(chatId, 0);
    },
    onFirstUserTurn: async (chatId) => {
      if (!substrateRef) return;
      try {
        await runFirstSendHook({
          store,
          chatId,
          defaultEnvMode: config.defaultEnvMode,
          checkpointStore: substrateRef.checkpointStore,
        });
      } catch (err) {
        console.warn(`[loom] runFirstSendHook failed for ${chatId}: ${(err as Error).message}`);
      }
    },
    onAssistantTurnComplete: (chatId, cwd) => {
      const counters = substrateRef?.turnCounters;
      if (!counters?.has(chatId)) return;
      const turn = counters.get(chatId)! + 1;
      counters.set(chatId, turn);
      void substrateRef!.reactor.captureTurn(chatId, turn, cwd);
    },
  });
  setEnvelopeBroadcaster((env) => bridge.routeHookEnvelope(env));

  const substrate = createChatDiffPanelSubstrate(bridge, config);
  substrateRef = substrate;

  const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
  const loomPort = parseInt(process.env.LOOM_PORT ?? "3737", 10);
  mountAllRoutes(routes, {
    store,
    config,
    bridge,
    substrate,
    receiverPort: loomPort,
    sessionStore,
    imageStore,
    permissionGate,
  });

  const server = await startServer({
    port: loomPort,
    routes,
    bridge,
  });
  console.log(
    `loom-server listening at ${server.url} (root: ${config.root ?? "<none>"} / source: ${config.source})`,
  );

  // Hooks-health preflight. Single line — the UI surfaces the same
  // signal via HooksHealthBanner, but headless / dev users see it here.
  // Never fatal: we don't want a missing settings.json to block boot.
  try {
    const hs = buildHooksStatus({ receiverPort: loomPort });
    if (!hs.installed) {
      console.warn(
        `[loom] hooks not installed in ${hs.settingsPath} — permission prompts and AskUserQuestion popups won't appear. POST /hooks/install to install.`,
      );
    } else if (!hs.healthy) {
      const missing = hs.eventsExpected.filter((e) => !hs.eventsInstalled.includes(e));
      console.warn(
        `[loom] hooks installed but out of date — missing ${missing.join(", ")} in ${hs.settingsPath}. POST /hooks/install to reinstall.`,
      );
    }
  } catch (err) {
    console.warn(`[loom] hooks preflight skipped: ${(err as Error)?.message ?? err}`);
  }

  const shutdown = async (sig: string) => {
    console.log(`[loom-server] received ${sig}, shutting down...`);
    try {
      substrate.headWatcherSubscription?.unsubscribe();
    } catch {}
    try {
      substrate.headWatcher.dispose();
    } catch {}
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
