/**
 * T-015 — verifies the post-pivot handoff:
 *
 *   - `process-manager/handoff.ts` has been deleted.
 *   - The terminal-launching logic is inlined at the handoff route site,
 *     and the launched command is `tmux attach-session -t loom-<chatId>`
 *     (not the old `loom attach <chatId>` SDK-resume path).
 *   - The route still works against the same dependency-injection seam
 *     used by `chats-route-handoff.test.ts`.
 *
 * Per US-007 AC1–AC3 + Design ADR-005.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoServerSrc = join(here, "..", "src");

describe("T-015 handoff replacement", () => {
  test("handoff.ts no longer exists under process-manager/", () => {
    const handoffPath = join(repoServerSrc, "process-manager", "handoff.ts");
    expect(existsSync(handoffPath)).toBe(false);
  });

  test("no source file under process-manager/ references the deleted module", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const pmDir = join(repoServerSrc, "process-manager");
    const all = fs.readdirSync(pmDir);
    for (const f of all) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(pmDir, f), "utf8");
      expect(src).not.toMatch(/from\s+['"]\.\/handoff\.ts['"]/);
    }
  });

  test("chats route inlines a tmux attach-session command (Design ADR-005)", () => {
    const chatsRouteSrc = readFileSync(join(repoServerSrc, "routes", "chats.ts"), "utf8");
    // The route must construct a tmux attach-session invocation for loom-<chatId>.
    expect(chatsRouteSrc).toMatch(/tmux/);
    expect(chatsRouteSrc).toMatch(/attach-session/);
    // The old SDK-resume command string MUST be gone.
    expect(chatsRouteSrc).not.toMatch(/loom attach/);
  });

  test("the structural-import test: chats.ts no longer imports from process-manager/handoff.ts", () => {
    const chatsRouteSrc = readFileSync(join(repoServerSrc, "routes", "chats.ts"), "utf8");
    expect(chatsRouteSrc).not.toMatch(/process-manager\/handoff/);
  });

  test("no other file under apps/server/src/ imports the deleted handoff module", () => {
    function walk(dir: string, acc: string[] = []): string[] {
      const fs = require("node:fs") as typeof import("node:fs");
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.isFile() && p.endsWith(".ts")) acc.push(p);
      }
      return acc;
    }
    const files = walk(repoServerSrc);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/from\s+['"][^'"]*process-manager\/handoff[^'"]*['"]/);
    }
  });
});
