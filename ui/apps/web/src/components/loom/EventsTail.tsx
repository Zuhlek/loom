export type LoomEvent = {
  ts: string;
  level: "info" | "ok" | "warn" | "error";
  message: string;
};

export interface EventsTailProps {
  events: LoomEvent[];
  watching?: boolean;
}

const LEVEL_COLOR: Record<LoomEvent["level"], string> = {
  info: "rgba(255,255,255,0.7)",
  ok: "#34d399",
  warn: "#fbbf24",
  error: "#f87171",
};

export function EventsTail({ events, watching = true }: EventsTailProps) {
  return (
    <div className="border-t shrink-0" style={{ borderColor: "var(--border)", background: "#0a0a0a", color: "#d4d4d4" }}>
      <div className="px-3 py-1.5 border-b flex items-center gap-2 text-[10px]" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <span className={watching ? "size-1.5 rounded-full animate-pulse" : "size-1.5 rounded-full"} style={{ background: "var(--success)" }} />
        <span className="font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
          events.jsonl
        </span>
        <span className="font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          tail -f · debounced 200ms
        </span>
        <span className="ml-auto font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          {events[events.length - 1]?.ts ?? ""}
        </span>
      </div>
      <div className="px-3 py-2 max-h-32 overflow-y-auto font-mono text-[11px] space-y-0.5">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3">
            <span style={{ color: "rgba(255,255,255,0.4)" }}>{e.ts}</span>
            <span style={{ color: LEVEL_COLOR[e.level] }}>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
