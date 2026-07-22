/**
 * ToolResultMedia — renders tool_result image blocks as a thumbnail
 * inline element (single image) or a thumbnail strip (multi-image),
 * opening the shared focus-trapped {@link ImageLightbox} for full-viewport
 * viewing.
 *
 * Image bytes flow as base-64 + mediaType on the wire and the web
 * constructs `data:<mediaType>;base64,<dataB64>` URLs locally — no blob
 * URLs, no server route. Component prop is `images: ToolResultImage[]`.
 * Thumbnails render via the shared {@link ImageThumb}; the lightbox /
 * carousel behaviour lives in `ImageLightbox` so it stays identical to
 * user-message image viewing.
 */
import { useMemo } from "react";

import type { ToolResultImage } from "../../lib/chat-types";
import type { LightboxImage } from "../../lib/chat-images";
import { ImageLightbox, useLightbox } from "./ImageLightbox";
import { ImageThumb } from "./ImageThumb";

interface Props {
  images: ToolResultImage[];
}

export function ToolResultMedia({ images }: Props) {
  const { index, isOpen, open, close } = useLightbox();

  const lightboxImages = useMemo<LightboxImage[]>(
    () =>
      (images ?? []).map((img) => ({
        src: `data:${img.mediaType};base64,${img.dataB64}`,
        alt: img.alt,
      })),
    [images],
  );

  if (!images || images.length === 0) return null;

  const single = images.length === 1;

  return (
    <div className="mt-2">
      <div
        className={single ? undefined : "flex flex-wrap gap-2"}
        role={single ? undefined : "list"}
        aria-label={single ? undefined : "Tool result images"}
      >
        {images.map((img, idx) => (
          <ImageThumb
            key={idx}
            src={lightboxImages[idx].src}
            alt={img.alt}
            onClick={() => open(idx)}
            ariaLabel={
              single ? "Tool result image" : `Tool result image ${idx + 1} of ${images.length}`
            }
            className={single ? "max-h-64" : "size-20"}
            fit={single ? "contain" : "cover"}
            wrapAsListItem={!single}
          />
        ))}
      </div>
      {isOpen && (
        <ImageLightbox
          images={lightboxImages}
          activeIndex={index}
          onChangeIndex={open}
          onClose={close}
          label="Tool result image viewer"
        />
      )}
    </div>
  );
}
