/**
 * FabricArchiveDialog — lists archived fabrics with a search filter and
 * a one-click reinstate affordance per row. The dialog refreshes the
 * sidebar after each unarchive so the row reappears in the flat list.
 */
import { useEffect, useMemo, useState } from "react";
import {
  listArchivedFabrics,
  unarchiveFabric,
  type ArchivedFabric,
} from "../../lib/api";

interface Props {
  onClose: () => void;
  onAfterUnarchive?: () => void | Promise<void>;
}

export function FabricArchiveDialog({ onClose, onAfterUnarchive }: Props) {
  const [rows, setRows] = useState<ArchivedFabric[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { archived } = await listArchivedFabrics();
      setRows(archived);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "failed to load archive");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.fabricName.toLowerCase().includes(q) ||
        r.cwd.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const onReinstate = async (id: string) => {
    try {
      await unarchiveFabric(id);
      await refresh();
      await onAfterUnarchive?.();
    } catch (err) {
      console.warn("[loom] unarchiveFabric failed", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={onClose}
      data-testid="fabric-archive-dialog"
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl border bg-white overflow-hidden"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-4 border-b flex items-center gap-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-semibold tracking-tight flex-1">
            Archived fabrics
          </h2>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 rounded hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Close"
          >
            close
          </button>
        </div>

        <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search archived fabrics…"
            className="w-full bg-transparent border rounded px-2 py-1 text-xs outline-none"
            style={{ borderColor: "var(--border)" }}
            data-testid="fabric-archive-search"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p
              className="px-5 py-6 text-xs text-center"
              style={{ color: "var(--muted-foreground)" }}
            >
              Loading…
            </p>
          ) : error ? (
            <p
              className="px-5 py-6 text-xs text-center"
              style={{ color: "var(--destructive-foreground)" }}
            >
              {error}
            </p>
          ) : filtered.length === 0 ? (
            <p
              className="px-5 py-6 text-xs text-center"
              style={{ color: "var(--muted-foreground)" }}
            >
              {rows.length === 0
                ? "No fabrics archived yet."
                : "No matches."}
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {filtered.map((row) => (
                <li
                  key={row.id}
                  className="px-5 py-2.5 flex items-center gap-3"
                  data-testid="fabric-archive-row"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {row.fabricName}
                    </div>
                    <div
                      className="text-[10px] font-mono truncate"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {row.cwd}
                    </div>
                  </div>
                  <button
                    onClick={() => void onReinstate(row.id)}
                    className="text-[11px] px-2 py-0.5 rounded hover:bg-[var(--accent)]"
                    style={{
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                    }}
                    data-testid="fabric-archive-reinstate"
                  >
                    Reinstate
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
