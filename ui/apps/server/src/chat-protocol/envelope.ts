/**
 * Command-agnostic chat protocol envelope.
 *
 * Wire format: { kind, "chat-id", body }. Both clients and servers
 * use this shape; the dispatcher routes by `kind`.
 */
export interface ChatEnvelope<TBody = unknown> {
  kind: string;
  "chat-id"?: string;
  body?: TBody;
}

export type EnvelopeKind =
  | "pty-bytes-up"
  | "pty-bytes-down"
  | "chat-spawn"
  | "chat-resume"
  | "gate-pending"
  | "gate-resolved"
  | "permission-decision"
  | "transcript-record"
  | "error";

export function makeEnvelope<TBody>(
  kind: string,
  chatId: string | undefined,
  body: TBody | undefined,
): ChatEnvelope<TBody> {
  return { kind, "chat-id": chatId, body };
}

export function makeError(chatId: string | undefined, message: string): ChatEnvelope<{ message: string }> {
  return makeEnvelope("error", chatId, { message });
}
