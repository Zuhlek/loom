import { useEffect, type RefObject } from "react";

/**
 * Close a popover on outside-click (mousedown outside `ref`) or Escape.
 * No-op while `open` is false, so listeners are only attached when shown.
 * Shared by the composer pills (permission / model selector / model settings).
 */
export function usePopoverClose(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const node = ref.current;
      if (node && !node.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}
