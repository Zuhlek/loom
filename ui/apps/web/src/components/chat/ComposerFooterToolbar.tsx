import type { ReactNode } from "react";

/**
 * Pure layout container for the composer footer row. The per-chat model
 * / reasoning / mode / access settings that used to live here as pills
 * now live in the {@link ChatSettingsModal} (opened from the gear icon
 * anchored to the top-right of the chat window), so the footer keeps
 * only the ambient, non-setting affordances:
 *
 * `workspace` (left-most) surfaces the chat's git context — repo, branch,
 * and working-tree mode. The slot is optional; chats without a resolved
 * VCS context omit it and the layout collapses gracefully. A flex spacer
 * pushes the context-usage indicator + send button to the right edge.
 */
export interface ComposerFooterToolbarProps {
  workspace?: ReactNode;
  contextUsage: ReactNode;
  sendButton: ReactNode;
}

export function ComposerFooterToolbar({
  workspace,
  contextUsage,
  sendButton,
}: ComposerFooterToolbarProps) {
  return (
    <div
      className="flex-1 flex items-center gap-1.5"
      data-testid="composer-footer-toolbar"
    >
      {workspace}
      <span className="flex-1" />
      {contextUsage}
      {sendButton}
    </div>
  );
}
