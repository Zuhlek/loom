import { useState } from "react";
import clsx from "clsx";

export interface MockupIframeProps {
  /** List of files visible in the file switcher */
  files: string[];
  /** Currently-rendered file */
  active: string;
  /** Resolved iframe src; mockup renders a placeholder if undefined */
  src?: string;
  onSelect?: (file: string) => void;
}

export function MockupIframe({ files, active, src, onSelect }: MockupIframeProps) {
  const [selected, setSelected] = useState(active);
  const select = (f: string) => {
    setSelected(f);
    onSelect?.(f);
  };
  return (
    <div className="flex-1 flex min-w-0">
      <div className="w-56 shrink-0 border-r overflow-y-auto" style={{ borderColor: "var(--border)" }}>
        <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wide font-medium" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
          Mockup files
        </div>
        <div className="px-1 py-1 space-y-0.5">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => select(f)}
              className={clsx(
                "w-full text-left px-2 py-1 rounded text-[12px] font-mono",
                selected === f ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="border-b px-3 py-1.5 flex items-center gap-2 text-[11px]" style={{ borderColor: "var(--border)" }}>
          <span className="size-1.5 rounded-full" style={{ background: "var(--success)" }} />
          <code className="font-mono">{selected}</code>
          <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            sandboxed iframe · script-src 'none'
          </span>
        </div>
        <div className="flex-1 grid place-items-center bg-[rgba(0,0,0,0.03)]">
          {src ? (
            <iframe src={src} sandbox="" className="w-full h-full" title={`Mockup ${selected}`} />
          ) : (
            <div className="text-center px-6 py-12 max-w-md text-sm" style={{ color: "var(--muted-foreground)" }}>
              <p className="font-medium" style={{ color: "var(--foreground)" }}>
                {selected}
              </p>
              <p className="text-[11px] mt-2">
                Sandboxed iframe placeholder. In a real run, this would render the chosen mockup HTML with <code className="font-mono">script-src 'none'</code> to neutralize Tailwind CDN's runtime in case of a hostile mockup.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
