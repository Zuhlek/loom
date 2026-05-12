/**
 * LoomEmptyState — rendered by `LoomViewLive` when
 * `GET /loom/:projectId/:loomName` returns 404. Names the loom, the
 * project, and the project's declared paths so the user understands
 * the unresolvable-loom case without a generic "fetch failed"
 * surface (US-008 AC1, AC3).
 */
import { Link } from "wouter";

interface Props {
  loomName: string;
  projectName: string;
  paths: string[];
}

export function LoomEmptyState({ loomName, projectName, paths }: Props) {
  return (
    <div
      className="px-6 py-10 max-w-2xl mx-auto"
      data-testid="loom-empty-state"
    >
      <h1 className="text-base font-semibold mb-1">
        No loom directory at <code className="font-mono">{loomName}</code>
      </h1>
      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
        Project <strong>{projectName}</strong> has no <code className="font-mono">.loom/{loomName}/</code> directory
        under any of its declared paths.
      </p>
      {paths.length > 0 ? (
        <>
          <p className="text-[11px] mt-4 mb-1" style={{ color: "var(--muted-foreground)" }}>
            Declared paths searched
          </p>
          <ul className="rounded-md border divide-y" style={{ borderColor: "var(--border)" }}>
            {paths.map((p) => (
              <li
                key={p}
                className="px-3 py-2 font-mono text-[11px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {p}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="mt-6">
        <Link
          href="/"
          className="text-xs underline"
          style={{ color: "var(--muted-foreground)" }}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
