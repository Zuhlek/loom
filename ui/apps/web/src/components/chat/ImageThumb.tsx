/**
 * ImageThumb — one clickable image thumbnail with a built-in
 * "image unavailable" fallback. Shared by tool-result screenshots,
 * chat-bubble user images, and the QuestionNav strip so every thumbnail
 * behaves identically (click-to-zoom cursor + graceful onError).
 *
 * Source-agnostic: the caller passes a resolved `src` (see
 * `lib/chat-images.ts#imageSrc`), whether that is an inline `data:` URL
 * or the `/api/chat-image` read-back route. A failed load swaps to a
 * placeholder cell instead of a broken `<img>` — this is what keeps a
 * transient read-back miss from looking like the thumbnail "vanished".
 *
 * `fit="cover"` (default) fills a fixed square cell (bubble / nav strips);
 * `fit="contain"` preserves the natural aspect ratio inside a max-size
 * box (the inline tool-result preview).
 */
import { useState } from "react";

interface Props {
  src: string;
  alt?: string;
  title?: string;
  onClick?: () => void;
  /** Sizing / shape classes for both the button and the placeholder. */
  className?: string;
  fit?: "cover" | "contain";
  /** Wrap the cell in a `role="listitem"` for gallery strips. */
  wrapAsListItem?: boolean;
  ariaLabel?: string;
}

export function ImageThumb({
  src,
  alt,
  title,
  onClick,
  className,
  fit = "cover",
  wrapAsListItem,
  ariaLabel,
}: Props) {
  const [failed, setFailed] = useState(false);

  const cell = failed ? (
    <div
      className={`flex items-center justify-center rounded border text-[10px] ${className ?? ""}`}
      style={{
        borderColor: "var(--border)",
        background: "rgba(0,0,0,0.04)",
        color: "var(--muted-foreground)",
        minWidth: 32,
        minHeight: 32,
      }}
      role="img"
      aria-label="image unavailable"
      title={title}
    >
      image unavailable
    </div>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className={`overflow-hidden rounded border cursor-zoom-in hover:opacity-90 transition ${className ?? ""}`}
      style={{ borderColor: "var(--border)", padding: 0 }}
      aria-label={ariaLabel ?? alt ?? "Open image"}
      title={title}
    >
      <img
        src={src}
        alt={alt ?? ""}
        onError={() => setFailed(true)}
        className={fit === "cover" ? "size-full" : undefined}
        style={
          fit === "cover"
            ? { display: "block", objectFit: "cover" }
            : { display: "block", maxWidth: "100%", height: "auto" }
        }
      />
    </button>
  );

  return wrapAsListItem ? <div role="listitem">{cell}</div> : cell;
}
