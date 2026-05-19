/**
 * ToolResultMedia — renders tool_result image blocks as a thumbnail
 * inline element (single image) or a thumbnail strip (multi-image),
 * with a focus-trapped lightbox modal for full-viewport viewing.
 *
 * Image bytes flow as base-64 + mediaType on the wire and the web
 * constructs `data:<mediaType>;base64,<dataB64>` URLs locally — no
 * blob URLs, no server route. Component prop is
 * `images: ToolResultImage[]`.
 *
 * Accessibility:
 *   - Lightbox traps focus inside the portal while open; Tab/Shift+Tab
 *     cycle the focusable buttons. Previously focused element is
 *     restored on close.
 *   - Escape closes the lightbox.
 *   - Backdrop click closes the lightbox.
 *   - Left / Right arrows cycle the gallery in multi-image mode.
 *
 * Failure mode:
 *   - `<img>` `onError` swaps the failed image for an "image
 *     unavailable" placeholder cell without throwing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ToolResultImage } from "../../lib/chat-types";

interface Props {
  images: ToolResultImage[];
}

export function ToolResultMedia({ images }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const open = lightboxIndex !== null;

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const openLightbox = useCallback((idx: number) => setLightboxIndex(idx), []);

  if (!images || images.length === 0) return null;

  // Single image: inline thumbnail with click-to-expand.
  if (images.length === 1) {
    const img = images[0];
    return (
      <div className="mt-2">
        <ImageThumb
          image={img}
          onClick={() => openLightbox(0)}
          ariaLabel="Tool result image"
          className="max-h-64"
        />
        {open && (
          <MediaLightbox
            images={images}
            activeIndex={lightboxIndex!}
            onChangeIndex={setLightboxIndex}
            onClose={closeLightbox}
          />
        )}
      </div>
    );
  }

  // Multi-image: thumbnail strip + gallery lightbox.
  return (
    <div className="mt-2">
      <div
        className="flex flex-wrap gap-2"
        role="list"
        aria-label="Tool result images"
      >
        {images.map((img, idx) => (
          <ImageThumb
            key={idx}
            image={img}
            onClick={() => openLightbox(idx)}
            ariaLabel={`Tool result image ${idx + 1} of ${images.length}`}
            className="size-20"
            wrapAsListItem
          />
        ))}
      </div>
      {open && (
        <MediaLightbox
          images={images}
          activeIndex={lightboxIndex!}
          onChangeIndex={setLightboxIndex}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}

// ─── Thumbnail ───────────────────────────────────────────────────────

interface ImageThumbProps {
  image: ToolResultImage;
  onClick(): void;
  ariaLabel: string;
  className?: string;
  wrapAsListItem?: boolean;
}

function ImageThumb({
  image,
  onClick,
  ariaLabel,
  className,
  wrapAsListItem,
}: ImageThumbProps) {
  const [failed, setFailed] = useState(false);
  const src = `data:${image.mediaType};base64,${image.dataB64}`;

  const cell = failed ? (
    <div
      className={`flex items-center justify-center rounded border text-[10px] ${className ?? ""}`}
      style={{
        borderColor: "var(--border)",
        background: "rgba(0,0,0,0.04)",
        color: "var(--muted-foreground)",
        minWidth: 80,
        minHeight: 80,
      }}
      role="img"
      aria-label="image unavailable"
    >
      image unavailable
    </div>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className={`overflow-hidden rounded border cursor-zoom-in hover:opacity-90 transition ${className ?? ""}`}
      style={{ borderColor: "var(--border)", padding: 0 }}
      aria-label={ariaLabel}
    >
      <img
        src={src}
        alt={image.alt ?? ariaLabel}
        onError={() => setFailed(true)}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      />
    </button>
  );

  return wrapAsListItem ? <div role="listitem">{cell}</div> : cell;
}

// ─── Lightbox (focus-trap modal portal) ──────────────────────────────

interface LightboxProps {
  images: ToolResultImage[];
  activeIndex: number;
  onChangeIndex(idx: number): void;
  onClose(): void;
}

function MediaLightbox({
  images,
  activeIndex,
  onChangeIndex,
  onClose,
}: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus, and seed initial focus inside the portal.
  useEffect(() => {
    previousFocusRef.current = (typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null);
    // Defer to ensure the portal node exists.
    const id = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
    };
  }, []);

  // Keyboard handling: Escape closes; arrows cycle the gallery; Tab
  // is constrained inside the overlay (focus-trap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (images.length > 1) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onChangeIndex((activeIndex + 1) % images.length);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChangeIndex((activeIndex - 1 + images.length) % images.length);
          return;
        }
      }
      if (e.key === "Tab") {
        // Cycle focus among the buttons inside the overlay.
        const root = overlayRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !root.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, images.length, onChangeIndex, onClose]);

  if (typeof document === "undefined") return null;

  const active = images[activeIndex];
  const src = `data:${active.mediaType};base64,${active.dataB64}`;

  const overlay = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Tool result image viewer"
      onClick={(e) => {
        // Backdrop click closes — only when the click landed on the
        // overlay itself, not on a child (so the image area doesn't
        // dismiss).
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.82)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 36,
          height: 36,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.4)",
          background: "rgba(0,0,0,0.5)",
          color: "white",
          fontSize: 18,
          cursor: "pointer",
        }}
      >
        ×
      </button>

      {images.length > 1 && (
        <button
          type="button"
          onClick={() =>
            onChangeIndex((activeIndex - 1 + images.length) % images.length)
          }
          aria-label="Previous image"
          style={navButtonStyle("left")}
        >
          ‹
        </button>
      )}

      <img
        src={src}
        alt={active.alt ?? `Tool result image ${activeIndex + 1} of ${images.length}`}
        style={{
          maxWidth: "92vw",
          maxHeight: "82vh",
          objectFit: "contain",
          background: "transparent",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
        // onError on the lightbox image too — fall back inline rather
        // than throw out of the portal.
        onError={(e) => {
          const el = e.currentTarget;
          el.replaceWith(
            Object.assign(document.createElement("div"), {
              textContent: "image unavailable",
              style: "color:white;font-size:14px;",
            }),
          );
        }}
      />

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => onChangeIndex((activeIndex + 1) % images.length)}
            aria-label="Next image"
            style={navButtonStyle("right")}
          >
            ›
          </button>

          {/* Bottom thumbnail strip */}
          <div
            role="list"
            aria-label="Image gallery"
            style={{
              position: "absolute",
              bottom: 16,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              gap: 8,
              padding: "0 16px",
              overflowX: "auto",
            }}
          >
            {images.map((img, idx) => {
              const tsrc = `data:${img.mediaType};base64,${img.dataB64}`;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  role="listitem"
                  onClick={() => onChangeIndex(idx)}
                  aria-label={`Show image ${idx + 1} of ${images.length}`}
                  aria-current={isActive ? "true" : undefined}
                  style={{
                    width: 48,
                    height: 48,
                    padding: 0,
                    border: isActive
                      ? "2px solid white"
                      : "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={tsrc}
                    alt=""
                    onError={(e) => {
                      e.currentTarget.style.opacity = "0.2";
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

function navButtonStyle(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute",
    [side]: 12,
    top: "50%",
    transform: "translateY(-50%)",
    width: 44,
    height: 44,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.4)",
    background: "rgba(0,0,0,0.5)",
    color: "white",
    fontSize: 24,
    cursor: "pointer",
  };
}
