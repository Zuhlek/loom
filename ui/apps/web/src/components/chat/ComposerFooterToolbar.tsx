import type { ReactNode } from "react";

/**
 * Pure layout container for the composer footer pill row. Named pill
 * slots arrange LTR with a flex spacer between the left-side pills and
 * the context-usage indicator; the send button anchors the right edge.
 *
 * `workspace` (left-most) surfaces the chat's git context — repo, branch,
 * and working-tree mode — in one pill. The slot is optional; chats
 * without a resolved VCS context omit it and the layout collapses
 * gracefully.
 */
export interface ComposerFooterToolbarProps {
  workspace?: ReactNode;
  modelSelector: ReactNode;
  modelSettings: ReactNode;
  buildPlanToggle: ReactNode;
  permissionLevel: ReactNode;
  contextUsage: ReactNode;
  sendButton: ReactNode;
}

export function ComposerFooterToolbar({
  workspace,
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
      {workspace}
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
