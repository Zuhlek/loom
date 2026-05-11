/**
 * HTTP + WS server built on Fastify + @fastify/websocket.
 *
 * Verifies Origin on every HTTP request and WS upgrade — only
 * localhost origins are allowed. Exposes /health, the hook-receiver
 * route mount, and a WS endpoint.
 *
 * Routes are passed in as a Fetch-style map (pathname → handler that
 * accepts a Web `Request` and returns a `Response`). A wildcard
 * catch-all bridges Fastify's request/reply to those handlers so the
 * existing mount* helpers in apps/server/src/routes/* don't need to
 * change.
 *
 * The WS endpoint understands two protocols:
 *   1. The legacy chat-protocol envelope `{ kind, "chat-id", body }`.
 *   2. The chat-PTY bridge frames: `{ kind: "attach", "chat-id" }`,
 *      `{ kind: "pty-in", "chat-id", body: { data } }`, etc.
 *
 * If a `bridge` instance is passed in, attach/pty-in frames are dispatched
 * through the bridge. Otherwise the optional `onWsMessage` callback is
 * invoked, falling back to an "unknown kind" error.
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { acquireLock } from "./lockfile.ts";
import { makeError, type ChatEnvelope } from "./chat-protocol/envelope.ts";
import type { ChatPtyBridge } from "./process-manager/chat-pty-bridge.ts";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  origins?: string[];
  routes?: Record<string, (req: Request, url: URL) => Response | Promise<Response>>;
  onWsMessage?: (data: ChatEnvelope, send: (msg: ChatEnvelope) => void) => void;
  bridge?: ChatPtyBridge;
  acquireLock?: boolean;
  lockPath?: string;
  version?: string;
}

const DEFAULT_VERSION = "0.0.1";

/**
 * Pattern-route matcher. Falls through after the exact-match miss in
 * the fetch handler. Keys may contain `:param` segments — they match
 * any single non-empty segment. Returns the handler whose key matches
 * the pathname, or undefined.
 */
function matchPatternRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  pathname: string,
): ((req: Request, url: URL) => Response | Promise<Response>) | undefined {
  const segs = pathname.split("/");
  for (const key of Object.keys(routes)) {
    if (!key.includes(":")) continue;
    const keySegs = key.split("/");
    if (keySegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < keySegs.length; i++) {
      const ks = keySegs[i] ?? "";
      const us = segs[i] ?? "";
      if (ks.startsWith(":")) {
        if (us.length === 0) {
          ok = false;
          break;
        }
        continue;
      }
      if (ks !== us) {
        ok = false;
        break;
      }
    }
    if (ok) return routes[key];
  }
  return undefined;
}

function isLocalhostOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) {
    // Tools like curl don't send Origin; allow when not present.
    return true;
  }
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1") {
      return true;
    }
    if (allowed.includes(origin)) return true;
    if (allowed.includes(u.host)) return true;
    return false;
  } catch {
    return false;
  }
}

export interface ServerHandle {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

interface WsConnState {
  origin: string | null;
  attachedChatId: string | null;
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port ?? 0; // 0 = random ephemeral
  const hostname = opts.hostname ?? "127.0.0.1";
  const origins = opts.origins ?? [];
  const routes = opts.routes ?? {};
  const version = opts.version ?? DEFAULT_VERSION;

  let lockRelease: (() => void) | undefined;
  if (opts.acquireLock !== false) {
    const result = acquireLock(opts.lockPath);
    if (!result.ok) {
      const err: any = new Error(result.message ?? "lockfile failed");
      err.code = "LOCK_FAILED";
      err.reason = result.reason;
      err.pid = result.pid;
      throw err;
    }
    lockRelease = result.release;
  }

  // Track which WS clients are attached to which chat so the bridge can
  // fan out `tasks-update` frames sourced from the transcript watcher.
  const attachedByChat = new Map<string, Set<WebSocket>>();
  const wsState = new WeakMap<WebSocket, WsConnState>();
  let unsubTasks: (() => void) | null = null;
  if (opts.bridge) {
    unsubTasks = opts.bridge.onTasksUpdate((chatId, tasks) => {
      const set = attachedByChat.get(chatId);
      if (!set) return;
      const payload = JSON.stringify({
        kind: "tasks-update",
        "chat-id": chatId,
        body: { tasks },
      });
      for (const ws of set) {
        try {
          ws.send(payload);
        } catch {}
      }
    });
  }

  const app: FastifyInstance = Fastify({ logger: false });

  // Hand every request body to handlers as a Buffer; routes call
  // new Request(...).json()/.formData()/.arrayBuffer() themselves.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  await app.register(websocketPlugin);

  // Origin gate. /ws is excluded here because @fastify/websocket attaches
  // its upgrade handler before this hook fires; the WS handler does its
  // own origin check.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/ws" || request.url.startsWith("/ws?")) return;
    const origin = request.headers.origin ?? null;
    if (!isLocalhostOrigin(origin, origins)) {
      reply.code(403).type("text/plain").send("forbidden: origin");
    }
  });

  app.get("/health", async (request, reply) => {
    const origin = request.headers.origin ?? "*";
    reply.header("access-control-allow-origin", origin);
    reply.header("content-type", "application/json");
    return { ok: true, version };
  });

  // WS endpoint.
  app.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
    const origin = request.headers.origin ?? null;
    if (!isLocalhostOrigin(origin, origins)) {
      socket.close();
      return;
    }
    wsState.set(socket, { origin, attachedChatId: null });

    socket.on("message", (raw) => {
      let envelope: ChatEnvelope;
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        envelope = JSON.parse(text);
      } catch {
        socket.send(JSON.stringify(makeError(undefined, "invalid json")));
        return;
      }
      if (!envelope || typeof envelope.kind !== "string") {
        socket.send(JSON.stringify(makeError(undefined, "missing kind")));
        return;
      }
      const send = (msg: ChatEnvelope) => socket.send(JSON.stringify(msg));

      if (opts.bridge) {
        if (envelope.kind === "attach") {
          const chatId = envelope["chat-id"];
          if (!chatId) {
            send(makeError(undefined, "attach: missing chat-id"));
            return;
          }
          try {
            opts.bridge.attach(chatId, makeWsClient(socket));
            const st = wsState.get(socket);
            if (st) st.attachedChatId = chatId;
            let set = attachedByChat.get(chatId);
            if (!set) {
              set = new Set();
              attachedByChat.set(chatId, set);
            }
            set.add(socket);
            send({
              kind: "attached",
              "chat-id": chatId,
              body: { ok: true },
            });
          } catch (err: any) {
            send(makeError(chatId, err?.message ?? "attach failed"));
          }
          return;
        }
        if (envelope.kind === "pty-in") {
          const chatId = envelope["chat-id"];
          const data = (envelope.body as any)?.data;
          if (!chatId || typeof data !== "string") {
            send(makeError(chatId, "pty-in: missing chat-id or body.data"));
            return;
          }
          opts.bridge.write(chatId, data);
          return;
        }
        if (envelope.kind === "resize") {
          const chatId = envelope["chat-id"];
          const cols = Number((envelope.body as any)?.cols);
          const rows = Number((envelope.body as any)?.rows);
          if (!chatId || !Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
            send(makeError(chatId, "resize: missing chat-id or invalid cols/rows"));
            return;
          }
          opts.bridge.resize(chatId, Math.floor(cols), Math.floor(rows));
          return;
        }
        if (envelope.kind === "detach") {
          const chatId = envelope["chat-id"];
          if (chatId) {
            opts.bridge.detach(chatId, makeWsClient(socket));
            const st = wsState.get(socket);
            if (st) st.attachedChatId = null;
            const set = attachedByChat.get(chatId);
            if (set) {
              set.delete(socket);
              if (set.size === 0) attachedByChat.delete(chatId);
            }
          }
          return;
        }
      }

      if (opts.onWsMessage) {
        opts.onWsMessage(envelope, send);
      } else {
        send(makeError(envelope["chat-id"], `unknown kind: ${envelope.kind}`));
      }
    });

    socket.on("close", () => {
      const st = wsState.get(socket);
      const chatId = st?.attachedChatId ?? null;
      if (chatId && opts.bridge) {
        opts.bridge.detach(chatId, makeWsClient(socket));
      }
      if (chatId) {
        const set = attachedByChat.get(chatId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) attachedByChat.delete(chatId);
        }
      }
      wsState.delete(socket);
    });
  });

  // Catch-all that dispatches through the Fetch-style routes map.
  app.setNotFoundHandler(async (request, reply) => {
    const base = `http://${hostname}`;
    const url = new URL(request.url, base);
    const handler = routes[url.pathname] ?? matchPatternRoute(routes, url.pathname);
    if (!handler) {
      reply.code(404).type("text/plain").send("not found");
      return;
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (v == null) continue;
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(","));
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody && request.body instanceof Buffer ? request.body : undefined;

    const webReq = new Request(url.toString(), {
      method: request.method,
      headers,
      body,
    });

    const res = await handler(webReq, url);

    // Always include CORS for localhost dev (Vite proxy preserves Origin).
    try {
      res.headers.set("access-control-allow-origin", request.headers.origin ?? "*");
    } catch {}

    reply.code(res.status);
    for (const [k, v] of res.headers.entries()) {
      reply.header(k, v);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    reply.send(buf);
  });

  await app.listen({ port, host: hostname });
  const addr = app.server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: actualPort,
    url: `http://${hostname}:${actualPort}`,
    async stop() {
      try {
        await app.close();
      } catch {}
      try {
        unsubTasks?.();
      } catch {}
      attachedByChat.clear();
      if (lockRelease) lockRelease();
    },
  };
}

function makeWsClient(ws: WebSocket) {
  return {
    send(text: string) {
      try {
        ws.send(text);
      } catch {}
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

export const __test__ = { isLocalhostOrigin };
