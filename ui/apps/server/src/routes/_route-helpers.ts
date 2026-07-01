// Shared helpers for verb routes that touch the chat row + emit chat-meta-changed.

import { executeGit, GitCommandError } from "../git/worktree.ts";
import { ProviderAuthError } from "../source-control/errors.ts";
import { jsonResponse } from "./_response.ts";
import type {
  ChatMetaChangedFrame,
  ServerFrame,
} from "../chat-protocol/frames.ts";

export function errorMessage(e: unknown): string {
  if (e instanceof GitCommandError) {
    // GitCommandError.message embeds "git <args> exited N: <full stderr>" —
    // developer-facing plumbing. Strip the prefix and git's `hint:` spam,
    // then surface the real rejection/error line so the UI toast reads
    // cleanly (e.g. "! [rejected] master -> master (fetch first)").
    // ponytail: heuristic stderr pick, add explicit git-error→message
    // mapping when a real case reads badly.
    const lines = e.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("hint:"));
    const meaningful = lines.find((l) => /rejected|error:|fatal:/i.test(l));
    return meaningful ?? lines[0] ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Shared 401/500 wrapper for provider-routed errors. ProviderAuthError
 * surfaces as 401 with `code: "provider-auth"` so the web layer can
 * prompt for credentials; anything else is a 500 with the raw message.
 */
export function providerErrorResponse(e: unknown): Response {
  if (e instanceof ProviderAuthError) {
    return jsonResponse(
      { error: errorMessage(e), code: "provider-auth" },
      401,
    );
  }
  return jsonResponse({ error: errorMessage(e) }, 500);
}

/**
 * The project's default branch *name* (e.g. "main" or "master"), used both as
 * a comparison base and as a fallback branch identity for chats. Prefers the
 * branch named by `origin/HEAD`, but only when it resolves locally — so after
 * a rename (main → master) it returns the branch that actually exists rather
 * than the stale `origin/HEAD` name, which would make callers' `rev-parse`/
 * `rev-list` fail. Falls back to local "main"/"master", then "main".
 */
export async function getProjectDefaultBranch(cwd: string): Promise<string> {
  const resolves = async (ref: string): Promise<boolean> => {
    try {
      const r = await executeGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
        allowNonZeroExit: true,
      });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  };

  let remoteName: string | null = null;
  try {
    const r = await executeGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      allowNonZeroExit: true,
    });
    if (r.exitCode === 0) {
      const m = r.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
      if (m) remoteName = m[1]!;
    }
  } catch {}

  for (const cand of [remoteName, "main", "master"]) {
    if (cand && (await resolves(cand))) return cand;
  }
  return remoteName ?? "main";
}

export function emitChatMetaChanged(
  broadcast: (frame: ServerFrame) => void,
  chatId: string,
  branch: string | null,
  worktreePath: string | null,
): void {
  const frame: ChatMetaChangedFrame = {
    kind: "chat-meta-changed",
    "chat-id": chatId,
    body: { branch, worktreePath },
  };
  broadcast(frame);
}
