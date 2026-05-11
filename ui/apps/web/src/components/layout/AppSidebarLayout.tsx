import type { ReactNode } from "react";
import { Sidebar, type SidebarProps } from "../Sidebar";

interface AppSidebarLayoutProps {
  children: ReactNode;
  sidebar?: SidebarProps;
}

/**
 * App shell: 256px sidebar + main pane.
 * Mirrors t3code's AppSidebarLayout.tsx but rewritten for Loom's two-section
 * sidebar (Chats + Looms).
 */
export function AppSidebarLayout({ children, sidebar }: AppSidebarLayoutProps) {
  return (
    <div className="h-screen flex">
      <Sidebar {...(sidebar ?? {})} />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
