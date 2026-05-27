// M2 — assert no new file in the chat-diff-panel surface ships a
// multi-line `/* ... */` block-comment header. spec.md § Constraints:
// "No comments unless architectural one-liner."
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));

const NEW_CHAT_DIFF_PANEL_FILES = [
  // Server
  `${serverRoot}src/source-control/errors.ts`,
  `${serverRoot}src/source-control/index.ts`,
  `${serverRoot}src/source-control/types.ts`,
  `${serverRoot}src/source-control/github/provider.ts`,
  `${serverRoot}src/source-control/github/gh-cli.ts`,
  `${serverRoot}src/source-control/bitbucket/provider.ts`,
  `${serverRoot}src/source-control/bitbucket/api.ts`,
  `${serverRoot}src/git/resolve-branch-selection-target.ts`,
  `${serverRoot}src/git/vcs-kind.ts`,
  `${serverRoot}src/git/head-watcher.ts`,
  `${serverRoot}src/process-manager/first-send-hook.ts`,
  `${serverRoot}src/process-manager/turn-watcher.ts`,
  `${serverRoot}src/process-manager/persist-vcs-kind.ts`,
  `${serverRoot}src/checkpointing/checkpoint-store.ts`,
  `${serverRoot}src/checkpointing/checkpoint-diff-query.ts`,
  `${serverRoot}src/checkpointing/checkpoint-reactor.ts`,
  `${serverRoot}src/routes/chats-meta.ts`,
  `${serverRoot}src/routes/git-verbs.ts`,
  `${serverRoot}src/routes/git-worktree.ts`,
  `${serverRoot}src/routes/worktrees.ts`,
  `${serverRoot}src/routes/source-control-rpc.ts`,
  `${serverRoot}src/routes/_route-helpers.ts`,
  // Web
  `${webRoot}src/components/chat/ModeIndicatorPill.tsx`,
  `${webRoot}src/components/chat/AttachedRefPill.tsx`,
  `${webRoot}src/components/diff/TurnTimelineStrip.tsx`,
  `${webRoot}src/components/diff/vcs-verb-copy.ts`,
  `${webRoot}src/components/worktrees/ProjectWorktreesPanel.tsx`,
];

describe("M2 — block-comment file headers banned by spec § Constraints", () => {
  for (const file of NEW_CHAT_DIFF_PANEL_FILES) {
    test(`${file.split("/").slice(-3).join("/")} does not start with /* ... */`, () => {
      const src = readFileSync(file, "utf8");
      // The file MUST NOT open with a multi-line block-comment header.
      // Single-line `//` architectural comments are allowed.
      expect(src.startsWith("/*"), `${file} starts with a /* block comment`).toBe(false);
    });
  }
});
