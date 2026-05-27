// Shared helpers for verb routes that touch the chat row + emit chat-meta-changed.

import { executeGit } from "../git/worktree.ts";
import { ProviderAuthError } from "../source-control/errors.ts";
import { jsonResponse } from "./_response.ts";
import type {
  ChatMetaChangedFrame,
  ServerFrame,
} from "../chat-protocol/frames.ts";

export function errorMessage(e: unknown): string {
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

export async function getProjectDefaultBranch(cwd: string): Promise<string> {
  try {
    const r = await executeGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      allowNonZeroExit: true,
    });
    if (r.exitCode === 0) {
      const m = r.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
      if (m) return m[1]!;
    }
  } catch {}
  return "main";
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
