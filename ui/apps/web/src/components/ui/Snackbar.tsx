/**
 * Global snackbar / toast system. Inspired by t3code's `ui/toast.tsx`
 * but self-contained — no `@base-ui/react` dep. Single queue, stacked
 * top-right viewport, type variants (info/success/warning/error).
 *
 * Usage:
 *   const { show, dismiss } = useSnackbar();
 *   show({ type: "error", message: "Something exploded" });
 *
 * Errors and warnings stay until the user dismisses them; info and
 * success auto-dismiss after 4 s (override with `dismissAfterMs`).
 *
 * Identity: callers may pass a `key` to dedupe — repeat `show()` calls
 * with the same key update the existing toast in place instead of
 * stacking duplicates. That's what the live-chat error path uses to
 * avoid one banner per retry attempt.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";

export type SnackbarType = "info" | "success" | "warning" | "error";

export interface SnackbarOptions {
  /** Dedupe key. If supplied and a toast with this key is already
   *  visible, the existing toast is updated rather than a new one
   *  stacked. */
  key?: string;
  type: SnackbarType;
  message: string;
  /** Override auto-dismiss. Defaults: info/success 4 s; warning/error never. */
  dismissAfterMs?: number;
  /** Fired when the user clicks the dismiss button. */
  onDismiss?: () => void;
  /** Optional inline link rendered after the message. The href is
   *  opened in a new tab on click. Used by the Diff panel's PR-success
   *  toast (`kind: "pr"`) so the user can click straight through to
   *  the provider URL. */
  action?: { label: string; url: string };
}

interface SnackbarEntry extends SnackbarOptions {
  id: string;
}

interface SnackbarContextValue {
  show: (opts: SnackbarOptions) => string;
  dismiss: (id: string) => void;
  dismissByKey: (key: string) => void;
}

const SnackbarCtx = createContext<SnackbarContextValue | null>(null);

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarCtx);
  if (!ctx) {
    throw new Error("useSnackbar must be used inside <SnackbarProvider>");
  }
  return ctx;
}

let snackbarSeq = 0;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<SnackbarEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const dismissByKey = useCallback((key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }, []);

  const show = useCallback((opts: SnackbarOptions) => {
    const id = `sb-${++snackbarSeq}`;
    setEntries((prev) => {
      if (opts.key) {
        const idx = prev.findIndex((e) => e.key === opts.key);
        if (idx !== -1) {
          // Update existing in place — keep its id so the auto-dismiss
          // timer effect doesn't re-fire.
          const next = prev.slice();
          next[idx] = { ...prev[idx]!, ...opts };
          return next;
        }
      }
      return [...prev, { id, ...opts }];
    });
    return id;
  }, []);

  const value = useMemo<SnackbarContextValue>(
    () => ({ show, dismiss, dismissByKey }),
    [show, dismiss, dismissByKey],
  );

  return (
    <SnackbarCtx.Provider value={value}>
      {children}
      <SnackbarViewport entries={entries} onDismiss={dismiss} />
    </SnackbarCtx.Provider>
  );
}

function SnackbarViewport({
  entries,
  onDismiss,
}: {
  entries: SnackbarEntry[];
  onDismiss: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div
      data-slot="snackbar-viewport"
      className="fixed z-[100] left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]"
      style={{ top: "calc(var(--topbar-height) + 0.5rem)" }}
    >
      {entries.map((entry) => (
        <SnackbarItem key={entry.id} entry={entry} onDismiss={() => onDismiss(entry.id)} />
      ))}
    </div>
  );
}

function defaultAutoDismissMs(type: SnackbarType): number | null {
  switch (type) {
    case "info":
    case "success":
      return 4000;
    case "warning":
    case "error":
      return null;
  }
}

function SnackbarItem({
  entry,
  onDismiss,
}: {
  entry: SnackbarEntry;
  onDismiss: () => void;
}) {
  const auto = entry.dismissAfterMs ?? defaultAutoDismissMs(entry.type);
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (auto == null || auto <= 0) return;
    const id = window.setTimeout(() => {
      if (dismissedRef.current) return;
      onDismiss();
    }, auto);
    return () => window.clearTimeout(id);
    // Re-arm the timer when the message changes (in-place update via
    // `key` dedupe) so an updated toast doesn't auto-dismiss based on
    // the original timer.
  }, [auto, entry.message, onDismiss]);

  const handleDismiss = () => {
    dismissedRef.current = true;
    entry.onDismiss?.();
    onDismiss();
  };

  const palette = typePalette(entry.type);

  return (
    <div
      role={entry.type === "error" ? "alert" : "status"}
      data-testid="snackbar"
      data-snackbar-type={entry.type}
      className={clsx(
        "pointer-events-auto rounded-lg border shadow-lg px-3 py-2.5 flex items-start gap-2 text-[12px]",
        "animate-in fade-in slide-in-from-top-2",
      )}
      style={{
        background: palette.background,
        borderColor: palette.border,
        color: palette.foreground,
      }}
    >
      <SnackbarIcon type={entry.type} color={palette.icon} />
      <span className="flex-1 min-w-0 break-words leading-relaxed">
        {entry.message}
        {entry.action && (
          <>
            {" "}
            <a
              href={entry.action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
              style={{ color: palette.icon }}
              data-testid="snackbar-action"
            >
              {entry.action.label}
            </a>
          </>
        )}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="shrink-0 size-5 grid place-items-center rounded hover:bg-black/10"
        style={{ color: palette.foreground }}
      >
        ×
      </button>
    </div>
  );
}

function typePalette(type: SnackbarType): {
  background: string;
  border: string;
  foreground: string;
  icon: string;
} {
  switch (type) {
    case "info":
      return {
        background: "rgba(59,130,246,0.08)",
        border: "rgba(59,130,246,0.25)",
        foreground: "var(--foreground)",
        icon: "rgb(59,130,246)",
      };
    case "success":
      return {
        background: "rgba(16,185,129,0.10)",
        border: "rgba(16,185,129,0.25)",
        foreground: "var(--foreground)",
        icon: "rgb(16,185,129)",
      };
    case "warning":
      return {
        background: "rgba(234,179,8,0.10)",
        border: "rgba(234,179,8,0.30)",
        foreground: "var(--foreground)",
        icon: "rgb(202,138,4)",
      };
    case "error":
      return {
        background: "rgba(239,68,68,0.10)",
        border: "rgba(239,68,68,0.30)",
        foreground: "var(--destructive-foreground)",
        icon: "rgb(239,68,68)",
      };
  }
}

function SnackbarIcon({ type, color }: { type: SnackbarType; color: string }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    className: "size-4 shrink-0 mt-0.5",
    style: { color },
  };
  switch (type) {
    case "info":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
        </svg>
      );
    case "success":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "warning":
      return (
        <svg {...props}>
          <path d="M12 3l10 18H2L12 3z" strokeLinejoin="round" />
          <path d="M12 10v5M12 18h.01" strokeLinecap="round" />
        </svg>
      );
    case "error":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
        </svg>
      );
  }
}
