import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ClipboardEvent } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  $createComposerMentionNode,
  ComposerMentionNode,
} from "../../lib/composer-mention-node";
import {
  selectionFromPlainTextRange,
  serialiseCaretOffset,
  serialiseToPlainText,
} from "../../lib/composer-editor-bridge";

export interface ComposerEditorHandle {
  setPlainText(text: string): void;
  insertMention(path: string, range: { start: number; end: number }): void;
  getPlainText(): string;
  focus(): void;
}

export type ComposerKeyIntent =
  | { kind: "submit" }
  | { kind: "newline" }
  | { kind: "arrow-up" }
  | { kind: "arrow-down" }
  | { kind: "tab" }
  | { kind: "enter-menu" }
  | { kind: "escape" };

export interface ComposerEditorProps {
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onStateChange?: (state: { text: string; cursor: number }) => void;
  onKeyIntent?: (intent: ComposerKeyIntent, event: KeyboardEvent) => boolean;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(
    { placeholder, disabled, className, onStateChange, onKeyIntent, onPaste },
    ref,
  ) {
    return (
      <LexicalComposer
        initialConfig={{
          namespace: "ComposerEditor",
          nodes: [ComposerMentionNode],
          theme: {},
          editable: !disabled,
          onError: (error) => {
            throw error;
          },
        }}
      >
        <div className={className} style={{ position: "relative" }} onPaste={onPaste}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
                aria-placeholder={placeholder}
                placeholder={
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      pointerEvents: "none",
                      userSelect: "none",
                      color: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)",
                    }}
                    className="text-sm leading-relaxed"
                  >
                    {placeholder}
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ComposerImperativeHandlePlugin handleRef={ref} />
          <ComposerStateBridge onStateChange={onStateChange} />
          <ComposerKeyboardPlugin onKeyIntent={onKeyIntent} />
        </div>
      </LexicalComposer>
    );
  },
);

function ComposerImperativeHandlePlugin({
  handleRef,
}: {
  handleRef: React.ForwardedRef<ComposerEditorHandle>;
}) {
  const [editor] = useLexicalComposerContext();
  useImperativeHandle(
    handleRef,
    () => buildHandle(editor),
    [editor],
  );
  return null;
}

function buildHandle(editor: LexicalEditor): ComposerEditorHandle {
  return {
    getPlainText() {
      return editor.getEditorState().read(() => serialiseToPlainText($getRoot()));
    },
    setPlainText(text: string) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const lines = text.split("\n");
        for (const line of lines) {
          const paragraph = $createParagraphNode();
          if (line.length > 0) {
            paragraph.append($createTextNode(line));
          }
          root.append(paragraph);
        }
        root.selectEnd();
      });
    },
    insertMention(path: string, range: { start: number; end: number }) {
      editor.update(() => {
        const root = $getRoot();
        const selection = selectionFromPlainTextRange(editor, root, range);
        $setSelection(selection);
        selection.removeText();
        selection.insertNodes([
          $createComposerMentionNode(path),
          $createTextNode(" "),
        ]);
      });
    },
    focus() {
      editor.focus();
    },
  };
}

function ComposerKeyboardPlugin({
  onKeyIntent,
}: {
  onKeyIntent?: (intent: ComposerKeyIntent, event: KeyboardEvent) => boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const callbackRef = useRef(onKeyIntent);
  callbackRef.current = onKeyIntent;
  useEffect(() => {
    if (!editor) return;
    const unregister = [
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event) return false;
          const callback = callbackRef.current;
          if (!callback) return false;
          if (event.shiftKey) {
            return callback({ kind: "newline" }, event) ? true : false;
          }
          const menuHandled = callback({ kind: "enter-menu" }, event);
          if (menuHandled) {
            event.preventDefault();
            return true;
          }
          const submitHandled = callback({ kind: "submit" }, event);
          if (submitHandled) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const callback = callbackRef.current;
          if (!callback || !event) return false;
          if (callback({ kind: "escape" }, event)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          const callback = callbackRef.current;
          if (!callback || !event) return false;
          if (callback({ kind: "arrow-up" }, event)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          const callback = callbackRef.current;
          if (!callback || !event) return false;
          if (callback({ kind: "arrow-down" }, event)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          const callback = callbackRef.current;
          if (!callback || !event) return false;
          if (callback({ kind: "tab" }, event)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      // Backspace immediately to the right of an `@file` chip removes
      // the chip atomically. Without this handler the user has to first
      // arrow-select the chip and then press Delete — Lexical's
      // isolated-decorator defaults treat the chip as a single
      // selectable unit but don't fold "caret-after-chip + backspace"
      // into a chip removal. Registered at LOW priority so normal
      // character-backspace still wins when the previous node isn't a
      // chip.
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          if (!selection.isCollapsed()) return false;
          const anchor = selection.anchor;
          let prevNode = null;
          if (anchor.type === "element") {
            const elementNode = anchor.getNode();
            prevNode = elementNode.getChildAtIndex(anchor.offset - 1);
          } else if (anchor.type === "text" && anchor.offset === 0) {
            prevNode = anchor.getNode().getPreviousSibling();
          }
          if (prevNode instanceof ComposerMentionNode) {
            if (event) event.preventDefault();
            prevNode.remove();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    ];
    return () => {
      for (const fn of unregister) fn();
    };
  }, [editor]);
  return null;
}

function ComposerStateBridge({
  onStateChange,
}: {
  onStateChange?: (state: { text: string; cursor: number }) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Hold the latest callback in a ref so the update listener stays
  // registered across parent re-renders that pass a new function ref.
  const callbackRef = useRef(onStateChange);
  callbackRef.current = onStateChange;
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const callback = callbackRef.current;
      if (!callback) return;
      editorState.read(() => {
        const selection = $getSelection();
        const range = $isRangeSelection(selection) ? selection : null;
        callback({
          text: serialiseToPlainText($getRoot()),
          cursor: serialiseCaretOffset(range, $getRoot()),
        });
      });
    });
  }, [editor]);
  return null;
}
