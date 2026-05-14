import type { ReactNode } from "react";

/**
 * Pure layout container for the composer footer pill row. Five named
 * pill slots arrange LTR with a flex spacer between the permission-level
 * pill and the context-usage indicator; the send button (or stop /
 * queue affordance the parent composes) anchors the right edge.
 *
 * See {@link mockup/composer-footer.txt} for the visual reference.
 * Real pill components land in T-010..T-014; T-009 mounts placeholder
 * `<div>` stubs that share this prop shape so the dependent diffs stay
 * scoped to the pill files.
 */
export interface ComposerFooterToolbarProps {
  modelSelector: ReactNode;
  modelSettings: ReactNode;
  buildPlanToggle: ReactNode;
  permissionLevel: ReactNode;
  contextUsage: ReactNode;
  sendButton: ReactNode;
}

export function ComposerFooterToolbar({
  modelSelector,
  modelSettings,
  buildPlanToggle,
  permissionLevel,
  contextUsage,
  sendButton,
}: ComposerFooterToolbarProps) {
  return (
    <div
      className="flex-1 flex items-center gap-1.5"
      data-testid="composer-footer-toolbar"
    >
      {modelSelector}
      {modelSettings}
      {buildPlanToggle}
      {permissionLevel}
      <span className="flex-1" />
      {contextUsage}
      {sendButton}
    </div>
  );
}
