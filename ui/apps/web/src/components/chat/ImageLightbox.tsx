/**
 * ImageLightbox — a source-agnostic, focus-trapped lightbox modal with
 * carousel navigation. Generalised from the tool-result gallery so it can
 * be shared by tool-result screenshots (inline `data:` URLs) AND
 * user-message images (inline `data:` live / `/api/chat-image` read-back
 * on reattach). Callers pass resolved `LightboxImage[]` — see
 * `lib/chat-images.ts` (`imageSrc`, `collectUserImages`).
 *
 * Accessibility (unchanged from the original tool-result lightbox):
 *   - Focus trapped inside the portal while open; Tab/Shift+Tab cycle the
 *     focusable buttons. Previously focused element restored on close.
 *   - Escape closes; backdrop click closes.
 *   - Left / Right arrows cycle the gallery in multi-image mode.
 *
 * Failure mode: a failed `<img>` load swaps to an "image unavailable"
 * placeholder rather than throwing out of the portal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { LightboxImage } from "../../lib/chat-images";

interface LightboxProps {
  images: LightboxImage[];
  activeIndex: number;
  onChangeIndex(idx: number): void;
  onClose(): void;
  /** Accessible label for the dialog. */
  label?: string;
}

/**
 * Lightbox open/close state hook. `index` is only meaningful while
 * `isOpen`. `open(i)` sets the active image and opens; `close()` clears.
 */
export function useLightbox(): {
  index: number;
  isOpen: boolean;
  open: (i: number) => void;
  close: () => void;
} {
  const [index, setIndex] = useState<number | null>(null);
  const open = useCallback((i: number) => setIndex(i), []);
  const close = useCallback(() => setIndex(null), []);
  return { index: index ?? 0, isOpen: index !== null, open, close };
}

export function ImageLightbox({
  images,
  activeIndex,
  onChangeIndex,
  onClose,
  label = "Image viewer",
}: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus, and seed initial focus inside the portal.
  useEffect(() => {
    previousFocusRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const id = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, []);

  // Keyboard: Escape closes; arrows cycle; Tab constrained (focus-trap).
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
  if (images.length === 0) return null;

  const active = images[activeIndex] ?? images[0];

  const overlay = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="image-lightbox"
      onClick={(e) => {
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
          onClick={() => onChangeIndex((activeIndex - 1 + images.length) % images.length)}
          aria-label="Previous image"
          style={navButtonStyle("left")}
        >
          ‹
        </button>
      )}

      <img
        src={active.src}
        alt={active.alt ?? `Image ${activeIndex + 1} of ${images.length}`}
        style={{
          maxWidth: "92vw",
          maxHeight: "82vh",
          objectFit: "contain",
          background: "transparent",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
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
                    border: isActive ? "2px solid white" : "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={img.src}
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
