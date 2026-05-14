import type { ReactNode } from "react";
import { Link } from "wouter";

interface AppLayoutProps {
  /** Right side of the top bar — page title, breadcrumbs, action buttons. */
  topBar?: ReactNode;
  /** Left column. Renders nothing if omitted. */
  leftDrawer?: ReactNode;
  /** Right column (expanded panel). Renders nothing if omitted. */
  rightDrawer?: ReactNode;
  /**
   * Far-right slim rail — always visible icon strip that mirrors the
   * left navigation drawer's chrome. Used to toggle which `rightDrawer`
   * panel is visible (Tasks, Diff, …). Renders nothing if omitted.
   */
  rightRail?: ReactNode;
  /** Main pane content. Owns its own scrolling. */
  children: ReactNode;
}

export function AppLayout({ topBar, leftDrawer, rightDrawer, rightRail, children }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col">
      <header className="topbar pl-3 gap-3" style={{ background: "var(--card)" }}>
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-6" style={{ color: "var(--primary)" }} aria-hidden>
            <path d="M3 6 C 6 4, 9 8, 12 6 S 18 4, 21 6 L 21 18 C 18 16, 15 20, 12 18 S 6 16, 3 18 Z" />
          </svg>
          <span className="text-sm font-medium">loom</span>
        </Link>
        {topBar && (
          <div className="flex-1 flex items-center min-w-0 gap-3">{topBar}</div>
        )}
      </header>
      <div className="flex-1 flex min-h-0">
        {leftDrawer}
        <main className="flex-1 flex flex-col min-w-0">{children}</main>
        {rightDrawer}
        {rightRail}
      </div>
    </div>
  );
}
