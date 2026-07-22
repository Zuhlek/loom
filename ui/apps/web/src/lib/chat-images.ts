/**
 * chat-images — single source of truth for turning a `UserMessageImage`
 * into an `<img>` `src`, and for collecting every user-sent image in a
 * chat into one flat, ordered list for the shared image lightbox.
 *
 * Two `src` sources, mirroring the server (ADR-002):
 *   - inline `dataB64` (live turns) → `data:<mediaType>;base64,<…>`
 *   - staged `id` (reattach / page-refresh, no inline bytes) →
 *     `/api/chat-image?chatId=&id=` read-back route
 *   - neither → `undefined` (caller skips, no broken `<img>`)
 *
 * Centralising this removes the copy that previously lived inline in
 * both `QuestionNav` (`thumbSrc`) and `MessagesTimeline` (`renderImages`).
 */
import type { TimelineRow } from "./timeline-rows";
import type { UserMessageImage } from "./chat-types";

/** A resolved image for the shared lightbox / thumbnails. */
export interface LightboxImage {
  src: string;
  alt?: string;
  filename?: string;
}

/**
 * Resolve one `UserMessageImage` to an `<img>` src, or `undefined` when
 * the image carries neither inline bytes nor a staged id.
 */
export function imageSrc(img: UserMessageImage, chatId: string): string | undefined {
  if (img.dataB64) return `data:${img.mediaType};base64,${img.dataB64}`;
  if (img.id)
    return `/api/chat-image?chatId=${encodeURIComponent(chatId)}&id=${encodeURIComponent(img.id)}`;
  return undefined;
}

/**
 * Flatten every user-message image in the chat (in timeline order, then
 * per-message image order) into one `LightboxImage[]`, and return an
 * `indexOf(messageId, localIdx)` lookup that maps a click on a specific
 * message's Nth *resolvable* image to its position in that flat list.
 *
 * Only images that resolve to a src are included, so `localIdx` counts
 * resolvable images (matching what the thumbnails actually render).
 * `indexOf` returns -1 for an unknown key.
 */
export function collectUserImages(
  rows: readonly TimelineRow[],
  chatId: string,
): { images: LightboxImage[]; indexOf: (messageId: string, localIdx: number) => number } {
  const images: LightboxImage[] = [];
  // key = `${messageId}:${localIdx}` → global index
  const map = new Map<string, number>();

  for (const row of rows) {
    if (row.kind !== "user") continue;
    const msgImages = row.item.images ?? [];
    let local = 0;
    for (const img of msgImages) {
      const src = imageSrc(img, chatId);
      if (!src) continue;
      map.set(`${row.item.id}:${local}`, images.length);
      images.push({ src, alt: img.filename ?? "", filename: img.filename });
      local++;
    }
  }

  return {
    images,
    indexOf: (messageId, localIdx) => map.get(`${messageId}:${localIdx}`) ?? -1,
  };
}
