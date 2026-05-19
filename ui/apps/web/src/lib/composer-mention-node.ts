import { createElement } from "react";
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import ComposerMentionChip from "../components/chat/ComposerMentionChip";

export type SerializedComposerMentionNode = Spread<
  { type: "composer-mention"; version: 1; path: string },
  SerializedLexicalNode
>;

/**
 * Atomic chip node for accepted `@file` references. `isInline` +
 * `isIsolated` + `isKeyboardSelectable` are the static contract that
 * delegates backspace, arrow-step, and selection to Lexical's default
 * decorator-node handling (ADR-002). `getTextContent` returns
 * `@${path}` — the single source of truth for submit serialisation
 * (ADR-003) consumed by {@link serialiseToPlainText}.
 */
export class ComposerMentionNode extends DecoratorNode<JSX.Element> {
  __path: string;

  static getType(): string {
    return "composer-mention";
  }

  static clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__key);
  }

  static importJSON(json: SerializedComposerMentionNode): ComposerMentionNode {
    return $createComposerMentionNode(String(json.path ?? ""));
  }

  constructor(path: string, key?: NodeKey) {
    super(key);
    this.__path = path;
  }

  exportJSON(): SerializedComposerMentionNode {
    return { type: "composer-mention", version: 1, path: this.__path };
  }

  getTextContent(): string {
    return "@" + this.__path;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.setAttribute("data-composer-mention", this.__path);
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return createElement(ComposerMentionChip, { path: this.__path });
  }

  isInline(): true {
    return true;
  }

  isIsolated(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }
}

export function $createComposerMentionNode(path: string): ComposerMentionNode {
  return new ComposerMentionNode(path);
}

export function $isComposerMentionNode(
  node: LexicalNode | null | undefined,
): node is ComposerMentionNode {
  return node instanceof ComposerMentionNode;
}
