import {
  $createRangeSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type RangeSelection,
  type RootNode,
  type TextNode,
} from "lexical";

/**
 * Serialises the editor tree to the plain-text shape the legacy
 * trigger-detection effects in {@link ChatComposer} expect: one paragraph
 * per line, `LineBreakNode` → `"\n"`, every other leaf → its
 * `getTextContent()` (which yields `@${path}` for the mention chip).
 *
 * Assumes {@link https://lexical.dev PlainTextPlugin} keeps all text in
 * one paragraph (Shift+Enter inserts a `LineBreakNode` within the
 * paragraph, not a paragraph split). Cross-paragraph `"\n"` joining is
 * defensive for future-proofing; do not rely on it.
 */
export function serialiseToPlainText(root: RootNode): string {
  const paragraphs = root.getChildren();
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(serialiseParagraph(paragraph));
  }
  return lines.join("\n");
}

/**
 * Returns the index of the focus offset within the serialised plain
 * text. Returns 0 for a null selection. Walks the tree in the same order
 * as {@link serialiseToPlainText} so offsets stay consistent.
 */
export function serialiseCaretOffset(
  selection: RangeSelection | null,
  root: RootNode,
): number {
  if (selection === null) return 0;
  const focus = selection.focus;
  const cursor = { offset: 0, found: false, value: 0 };
  const paragraphs = root.getChildren();
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) cursor.offset += 1;
    walkForCaret(paragraphs[i], focus, cursor);
    if (cursor.found) return cursor.value;
  }
  return cursor.offset;
}

/**
 * Note: paragraph boundaries and intra-paragraph `LineBreakNode`s both
 * emit `"\n"`. PlainTextPlugin keeps content in one paragraph until an
 * explicit split, so this conflation is latent; if a future plugin
 * introduces multi-paragraph splits (rich-text mode, Markdown shortcuts,
 * etc.), the join logic in {@link serialiseToPlainText} needs revisiting
 * so that Shift+Enter-typed newlines don't collapse against paragraph
 * boundaries.
 */
function serialiseParagraph(paragraph: LexicalNode): string {
  if (!$isParagraphNode(paragraph)) return paragraph.getTextContent();
  let out = "";
  for (const child of paragraph.getChildren()) {
    if ($isLineBreakNode(child)) {
      out += "\n";
    } else if ($isTextNode(child)) {
      out += child.getTextContent();
    } else {
      out += child.getTextContent();
    }
  }
  return out;
}

interface CaretCursor {
  offset: number;
  found: boolean;
  value: number;
}

/**
 * Maps a plain-text `[start, end)` range — as produced by the
 * shell's trigger detectors against {@link serialiseToPlainText} —
 * back to a Lexical `RangeSelection`. Walks the root in the same
 * order as the serialiser so offsets stay consistent. Clamps
 * out-of-range inputs to `[0, totalPlainTextLength]` so stale
 * ranges from {@link ChatComposer} degrade gracefully (design
 * §Failure modes).
 */
export function selectionFromPlainTextRange(
  editor: LexicalEditor,
  root: RootNode,
  range: { start: number; end: number },
): RangeSelection {
  const segments = collectSegments(root);
  const total = segments.length === 0 ? 0 : segments[segments.length - 1].plainEnd;
  const start = clampOffset(range.start, total);
  const end = clampOffset(range.end, total);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const selection = $createRangeSelection();
  const anchor = resolveAnchor(segments, lo, root);
  const focus = resolveAnchor(segments, hi, root);
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  return selection;
}

interface SegmentBase {
  plainStart: number;
  plainEnd: number;
}

interface TextSegment extends SegmentBase {
  kind: "text";
  node: TextNode;
}

interface ElementSegment extends SegmentBase {
  kind: "element";
  paragraph: ParagraphNode;
  /** Index of the chip / linebreak within its paragraph. */
  indexInParagraph: number;
  /** Width contributed to plain text (chip length or 1 for line break). */
  width: number;
}

interface ParagraphBreakSegment extends SegmentBase {
  kind: "paragraph-break";
  /** The paragraph that ENDS at `plainStart`. */
  paragraph: ParagraphNode;
}

type Segment = TextSegment | ElementSegment | ParagraphBreakSegment;

function collectSegments(root: RootNode): Segment[] {
  const segments: Segment[] = [];
  const paragraphs = root.getChildren();
  let offset = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    if (i > 0 && $isParagraphNode(paragraphs[i - 1])) {
      segments.push({
        kind: "paragraph-break",
        plainStart: offset,
        plainEnd: offset + 1,
        paragraph: paragraphs[i - 1] as ParagraphNode,
      });
      offset += 1;
    }
    if (!$isParagraphNode(paragraph)) {
      const text = paragraph.getTextContent();
      offset += text.length;
      continue;
    }
    const children = paragraph.getChildren();
    for (let j = 0; j < children.length; j++) {
      const child = children[j];
      if ($isTextNode(child)) {
        const length = child.getTextContent().length;
        segments.push({
          kind: "text",
          node: child,
          plainStart: offset,
          plainEnd: offset + length,
        });
        offset += length;
      } else if ($isLineBreakNode(child)) {
        segments.push({
          kind: "element",
          paragraph,
          indexInParagraph: j,
          width: 1,
          plainStart: offset,
          plainEnd: offset + 1,
        });
        offset += 1;
      } else {
        const length = child.getTextContent().length;
        segments.push({
          kind: "element",
          paragraph,
          indexInParagraph: j,
          width: length,
          plainStart: offset,
          plainEnd: offset + length,
        });
        offset += length;
      }
    }
  }
  return segments;
}

interface AnchorPoint {
  key: string;
  offset: number;
  type: "text" | "element";
}

function resolveAnchor(
  segments: Segment[],
  offset: number,
  root: RootNode,
): AnchorPoint {
  if (segments.length === 0) {
    return { key: root.getKey(), offset: 0, type: "element" };
  }
  for (const segment of segments) {
    if (offset < segment.plainStart) continue;
    if (offset > segment.plainEnd) continue;
    if (segment.kind === "text") {
      return {
        key: segment.node.getKey(),
        offset: offset - segment.plainStart,
        type: "text",
      };
    }
    if (segment.kind === "element") {
      const atStart = offset <= segment.plainStart;
      return {
        key: segment.paragraph.getKey(),
        offset: atStart ? segment.indexInParagraph : segment.indexInParagraph + 1,
        type: "element",
      };
    }
    return {
      key: segment.paragraph.getKey(),
      offset: segment.paragraph.getChildrenSize(),
      type: "element",
    };
  }
  const last = segments[segments.length - 1];
  if (last.kind === "text") {
    return {
      key: last.node.getKey(),
      offset: last.node.getTextContent().length,
      type: "text",
    };
  }
  return {
    key: last.paragraph.getKey(),
    offset: last.paragraph.getChildrenSize(),
    type: "element",
  };
}

function clampOffset(value: number, total: number): number {
  if (!Number.isFinite(value)) return total;
  return Math.max(0, Math.min(total, Math.floor(value)));
}

function walkForCaret(node: LexicalNode, focus: RangeSelection["focus"], cursor: CaretCursor): void {
  if (cursor.found) return;
  if (node.getKey() === focus.key) {
    if (focus.type === "text") {
      cursor.value = cursor.offset + focus.offset;
      cursor.found = true;
      return;
    }
    if ($isParagraphNode(node)) {
      const children = node.getChildren();
      for (let i = 0; i < focus.offset && i < children.length; i++) {
        walkForCaret(children[i], focus, cursor);
        if (cursor.found) return;
      }
      cursor.value = cursor.offset;
      cursor.found = true;
      return;
    }
    cursor.value = cursor.offset;
    cursor.found = true;
    return;
  }
  if ($isLineBreakNode(node)) {
    cursor.offset += 1;
    return;
  }
  if ($isParagraphNode(node)) {
    for (const child of node.getChildren()) {
      walkForCaret(child, focus, cursor);
      if (cursor.found) return;
    }
    return;
  }
  cursor.offset += node.getTextContent().length;
}
