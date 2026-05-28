/**
 * T-027 / M7 — Live happy-path smoke gate.
 *
 * Drives the real bridge against a real `claude` binary inside a real
 * tmux session, and asserts that submitting a user prompt results in
 * both a user-text frame and an assistant-text frame on the WS within
 * a timing budget.
 *
 * Opt-in only — gated by `LOOM_SMOKE_LIVE=1`. Auto-skipped (with a
 * `console.warn`) when `tmux` or `claude` is not on the host. This
 * keeps the slow gate out of every CI run while making it trivial to
 * execute before a release / after a bridge change:
 *
 *   LOOM_SMOKE_LIVE=1 pnpm vitest run \
 *     apps/server/test/integration/happy-path-live.test.ts
 *
 * Closes `quality-review.md` M7: the structural fix for the
 * "420 passing tests still missed a 30-second user-reproducible
 * defect" failure mode. The unit/integration matrix covers the
 * negative space (env-degradation); this gate exercises the positive
 * space against the real backends.
 */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

import { createJsonlTailBridge } from "../../src/process-manager/jsonl/bridge.ts";
import { createTmuxSession } from "../../src/process-manager/tmux-session.ts";
import { probeTmux } from "../../src/process-manager/tmux-availability.ts";
import { createSessionIdStore } from "../../src/process-manager/session-store.ts";
import { createJsonlPathProbe } from "../../src/process-manager/jsonl-path-probe.ts";

function findOnPath(name: string): string | null {
  const PATH = process.env.PATH ?? "";
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      /* keep searching */
    }
  }
  return null;
}

async function decideGate(): Promise<{
  enabled: boolean;
  reason: string;
  claudeBin: string | null;
}> {
  if (process.env.LOOM_SMOKE_LIVE !== "1") {
    return {
      enabled: false,
      reason: "LOOM_SMOKE_LIVE is not '1' — skipping live happy-path gate (set it to enable).",
      claudeBin: null,
    };
  }
  const tmuxOk = await probeTmux();
  if (!tmuxOk.available) {
    return {
      enabled: false,
      reason: "tmux is not available on this host — skipping live happy-path gate.",
      claudeBin: null,
    };
  }
  const claudeBin = process.env.LOOM_CLAUDE_BIN ?? findOnPath("claude");
  if (!claudeBin || !existsSync(claudeBin)) {
    return {
      enabled: false,
      reason: "claude binary is not on PATH and LOOM_CLAUDE_BIN is unset — skipping live happy-path gate.",
      claudeBin: null,
    };
  }
  return { enabled: true, reason: "live gate engaged", claudeBin };
}

const gatePromise = decideGate();

// Vitest evaluates the describe block synchronously, so we settle the
// gate decision once and branch.
const gate = await gatePromise;
if (!gate.enabled) {
  // eslint-disable-next-line no-console
  console.warn(`[happy-path-live] SKIP — ${gate.reason}`);
}

const describeIfLive = gate.enabled ? describe : describe.skip;

describeIfLive("happy-path-live (M7) — user submit → assistant reply round-trips", () => {
  const timeoutMs = Number(
    process.env.LOOM_SMOKE_LIVE_TIMEOUT_MS ?? "45000",
  );

  it(
    "submits a fixed prompt; the WS receives a user-text frame then an assistant-text frame containing the keyword",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "loom-happy-live-"));
      const sessionStorePath = join(root, "session-id-store.json");
      const tailRootPath = join(root, "tail-root.json");

      const tmux = createTmuxSession({ claudeBin: gate.claudeBin! });
      const sessionStore = createSessionIdStore({ storagePath: sessionStorePath });
      const pathProbe = createJsonlPathProbe({ storagePath: tailRootPath });
      const bridge = createJsonlTailBridge({
        tmux,
        sessionStore,
        pathProbe,
        cwdResolver: () => process.cwd(),
      });

      const chatId = `c_happy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const collected: unknown[] = [];
      const ws = {
        send(text: string) {
          try {
            collected.push(JSON.parse(text));
          } catch {
            /* ignore non-JSON */
          }
        },
      };

      try {
        await bridge.attach(chatId, ws);

        const prompt =
          "Reply with exactly the word HELLO and nothing else, no punctuation.";
        await bridge.submitUserTurn(chatId, prompt);

        // Wait for both a user-text and an assistant-text frame.
        const start = Date.now();
        let userSeen = false;
        let assistantSeen = false;
        while (Date.now() - start < timeoutMs) {
          for (const frame of collected) {
            const f = frame as { kind?: string; body?: { item?: { kind?: string; text?: string; blocks?: Array<{ type?: string; text?: string }> } } };
            if (f.kind !== "item-append") continue;
            const item = f.body?.item;
            if (!item) continue;
            if (item.kind === "user-message" && typeof item.text === "string" && item.text.includes("HELLO")) {
              userSeen = true;
            }
            if (item.kind === "assistant-message" && Array.isArray(item.blocks)) {
              const text = item.blocks
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");
              if (/HELLO/i.test(text)) {
                assistantSeen = true;
              }
            }
          }
          if (userSeen && assistantSeen) break;
          await new Promise((r) => setTimeout(r, 250));
        }

        expect(
          userSeen,
          "expected a user-text frame containing the prompt to arrive on the WS within the timing budget",
        ).toBe(true);
        expect(
          assistantSeen,
          "expected an assistant-text frame containing HELLO to arrive on the WS within the timing budget",
        ).toBe(true);
      } finally {
        try {
          await bridge.dispose(chatId);
        } catch {
          /* best-effort cleanup */
        }
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
    // Outer test timeout: a bit more than the in-test polling budget so
    // a failure surfaces a clean assertion rather than a vitest abort.
    Number(process.env.LOOM_SMOKE_LIVE_TIMEOUT_MS ?? "45000") + 15000,
  );
});
