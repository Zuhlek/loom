/**
 * T-012 / US-008-009. Presentational @-file picker menu.
 *
 * Mirrors `ComposerSlashMenu.tsx`'s structure: parent-driven keyboard
 * navigation (selectedIndex / onHover), per-row onMouseDown
 * preventDefault to keep the textarea focused through the click,
 * onSelect emits the chosen path string.
 *
 * Rendering:
 *   - Outer container is role="listbox", absolute bottom-full,
 *     data-testid="composer-atfile-menu".
 *   - Per-row button: role="option", aria-selected wired to
 *     selectedIndex, mono basename + muted dirname.
 *   - Empty items + !loading → returns null.
 *   - Empty items + loading → single "Searching…" row inside the
 *     container.
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";

export interface ComposerAtFileMenuProps {
  items: string[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
  loading?: boolean;
}

/**
 * Split a path into basename + dirname. Pure file-local; no Node
 * `path` import (web build is DOM-only). When the path has no `/`,
 * basename is the whole path and dirname is the empty string.
 */
function splitPath(path: string): { basename: string; dirname: string } {
  const parts = path.split("/");
  const basename = parts[parts.length - 1] ?? path;
  const dirname = parts.slice(0, -1).join("/");
  return { basename, dirname };
}

export function ComposerAtFileMenu({
  items,
  selectedIndex,
  onHover,
  onSelect,
  loading,
}: ComposerAtFileMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0 && !loading) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      data-testid="composer-atfile-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border shadow-lg z-10"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {items.length === 0 && loading ? (
        <div
          className="px-3 py-1.5 text-xs"
          style={{ color: "var(--muted-foreground)" }}
        >
          Searching…
        </div>
      ) : (
        items.map((path, i) => {
          const { basename, dirname } = splitPath(path);
          return (
            <button
              key={path + ":" + i}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-row-index={i}
              onMouseDown={(e) => {
                // Prevent the textarea from losing focus before onClick fires.
                e.preventDefault();
              }}
              onClick={() => onSelect(path)}
              onMouseEnter={() => onHover(i)}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
                i === selectedIndex ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
              )}
            >
              <span className="font-mono">{basename}</span>
              {dirname && (
                <span style={{ color: "var(--muted-foreground)" }}>{dirname}</span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
