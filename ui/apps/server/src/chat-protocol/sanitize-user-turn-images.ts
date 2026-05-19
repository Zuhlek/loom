/**
 * Defensive sanitiser for the WS `user-turn` frame's `body.images`
 * field.
 *
 * Runs in `http-ws-server.ts`'s `user-turn` handler before forwarding
 * to `bridge.submitUserTurnWithPriority`. A misbehaving / malicious
 * client must not be able to crash the turn pipeline with malformed
 * image payloads. The sanitiser is intentionally permissive about
 * extra fields (it only validates the two required strings) — Anthropic
 * rejects oversize / wrong-MIME content downstream so we don't
 * re-validate those here.
 *
 * Lives in its own module rather than inline inside `http-ws-server.ts`
 * so it can be unit-tested in isolation. (The server file itself has
 * a pre-existing `await` outside `async` callback issue that breaks
 * esbuild's strict parse path used by vitest; that's tracked separately.)
 */
import type { UserTurnImage } from "./frames.ts";

/** Server-side cap. Matches the client-side cap (B-08). */
const MAX_IMAGES_PER_TURN = 4;

/**
 * Filter / shape an untrusted `body.images` payload into a
 * `UserTurnImage[]`, or `undefined` when nothing valid remains.
 *
 * - non-array / undefined / empty array ⇒ `undefined`
 * - entries that aren't plain objects ⇒ dropped
 * - entries with missing / non-string `mediaType` ⇒ dropped
 * - entries with missing / non-string `dataB64` ⇒ dropped
 * - oversize array ⇒ truncated to the first `MAX_IMAGES_PER_TURN`
 *
 * RED-phase stub: returns `undefined` unconditionally. Implementation
 * lands in the green phase.
 */
export function sanitizeUserTurnImages(raw: unknown): UserTurnImage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UserTurnImage[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const mediaType = obj.mediaType;
    const dataB64 = obj.dataB64;
    if (typeof mediaType !== "string") continue;
    if (typeof dataB64 !== "string") continue;
    const image: UserTurnImage = { mediaType, dataB64 };
    if (typeof obj.filename === "string") image.filename = obj.filename;
    out.push(image);
    if (out.length >= MAX_IMAGES_PER_TURN) break;
  }
  if (out.length === 0) return undefined;
  return out;
}
