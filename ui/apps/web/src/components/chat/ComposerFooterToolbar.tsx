import type { ReactNode } from "react";

/**
 * Pure layout container for the composer footer pill row. Named pill
 * slots arrange LTR with a flex spacer between the right-side pills and
 * the context-usage indicator; the send button anchors the right edge.
 *
 * `modeIndicator` (left-most) and `attachedRef` (just before the spacer)
 * surface the chat's working-tree mode and current git ref. Both slots
 * are optional — chats without a resolved mode or VCS context can omit
 * them and the toolbar layout collapses gracefully.
 */
export interface ComposerFooterToolbarProps {
  modeIndicator?: ReactNode;
  modelSelector: ReactNode;
  modelSettings: ReactNode;
  buildPlanToggle: ReactNode;
  permissionLevel: ReactNode;
  attachedRef?: ReactNode;
  contextUsage: ReactNode;
  sendButton: ReactNode;
}

export function ComposerFooterToolbar({
  modeIndicator,
  modelSelector,
  modelSettings,
  buildPlanToggle,
  permissionLevel,
  attachedRef,
  contextUsage,
  sendButton,
}: ComposerFooterToolbarProps) {
  return (
    <div
      className="flex-1 flex items-center gap-1.5"
      data-testid="composer-footer-toolbar"
    >
      {modeIndicator}
      {modelSelector}
      {modelSettings}
      {buildPlanToggle}
      {permissionLevel}
      <span className="flex-1" />
      {attachedRef}
      {contextUsage}
      {sendButton}
    </div>
  );
}
