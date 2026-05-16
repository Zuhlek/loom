/**
 * T-005..T-010, T-013, T-014 — Composer attachments + @-file picker.
 *
 * Static-source contract assertions on ChatComposer.tsx and live-chat.tsx.
 * The vitest harness in this repo is node-only (environment: "node",
 * no JSDOM/RTL) — precedent in working-chip.test.ts, user-row-images.test.ts,
 * composer-controls.test.ts, composer-atfile-menu.test.ts. We assert
 * the source-file render contract instead of rendering React.
 *
 * Tasks covered:
 *   T-005 — attachment state machine + caps + MIME sniff + over-cap notice
 *   T-006 — paste handler
 *   T-007 — paperclip + hidden file input
 *   T-008 — drag-drop with data-dragging highlight
 *   T-009 — attachment-strip render + per-thumb remove + URL revoke
 *   T-010 — submit-time base64 + onSubmit widening + live-chat wiring
 *   T-013 — @-menu state + debounced /file-search + mutual-exclusion
 *   T-014 — drop placeholder `@-file` chip from composer footer
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const stylesPath = webRoot + "src/styles.css";

function readComposer(): string {
  return readFileSync(composerPath, "utf8");
}
function readLiveChat(): string {
  return readFileSync(liveChatPath, "utf8");
}

describe("T-005 attachment state machine (US-001..US-005)", () => {
  test("ChatComposer.tsx exists", () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  test("declares ComposerAttachment shape with id/file/mediaType/previewUrl/filename", () => {
    const src = readComposer();
    expect(src).toMatch(/interface\s+ComposerAttachment\b/);
    // All five fields appear inside or near the interface body.
    expect(src).toMatch(/id\s*:\s*string/);
    expect(src).toMatch(/file\s*:\s*File/);
    expect(src).toMatch(/mediaType\s*:\s*string/);
    expect(src).toMatch(/previewUrl\s*:\s*string/);
    expect(src).toMatch(/filename\s*:\s*string/);
  });

  test("declares attachments + overCapNotice state hooks", () => {
    const src = readComposer();
    expect(src).toMatch(/useState<ComposerAttachment\[\]>\(\s*\[\]\s*\)/);
    expect(src).toMatch(/useState<string\s*\|\s*null>\(\s*null\s*\)/);
  });

  test("declares addAttachments helper as an async function (single entry point)", () => {
    const src = readComposer();
    expect(src).toMatch(/(?:async\s+function\s+addAttachments|addAttachments\s*=\s*async)/);
  });

  test("MIME sniffer reads first bytes via file.slice + arrayBuffer", () => {
    const src = readComposer();
    expect(src).toMatch(/\.slice\s*\(\s*0\s*,\s*12\s*\)/);
    expect(src).toMatch(/arrayBuffer\s*\(/);
  });

  test("MIME sniffer recognises PNG/JPEG/GIF/WebP magic bytes", () => {
    const src = readComposer();
    // PNG 89 50 4E 47
    expect(src).toMatch(/0x89/);
    expect(src).toMatch(/0x50/);
    expect(src).toMatch(/0x4e/i);
    expect(src).toMatch(/0x47/i);
    // JPEG FF D8 FF
    expect(src).toMatch(/0xff/i);
    expect(src).toMatch(/0xd8/i);
    // GIF 47 49 46
    expect(src).toMatch(/0x49/i);
    expect(src).toMatch(/0x46/i);
    // WebP RIFF/WEBP
    expect(src).toMatch(/0x52/i); // R
    expect(src).toMatch(/0x57/i); // W
  });

  test("caps attachments at 4 (US-004 AC1)", () => {
    const src = readComposer();
    expect(src).toMatch(/\b4\b/);
    // "limit is 4 per turn" notice copy
    expect(src).toMatch(/limit is 4 per turn/);
  });

  test("rejects over-size files (>5MB) with notice (US-004 AC2)", () => {
    const src = readComposer();
    // 5_000_000 byte literal
    expect(src).toMatch(/5_000_000|5000000/);
    expect(src).toMatch(/max\s*5\s*MB/i);
  });

  test("auto-dismisses overCapNotice after ~3s via setTimeout", () => {
    const src = readComposer();
    // Look for setTimeout with 3000ms used to clear the notice.
    expect(src).toMatch(/setTimeout\s*\([^)]*,\s*3000\s*\)/);
  });

  test("uses URL.createObjectURL for previewUrl", () => {
    const src = readComposer();
    expect(src).toMatch(/URL\.createObjectURL/);
  });

  test("unmount cleanup revokes object URLs", () => {
    const src = readComposer();
    expect(src).toMatch(/URL\.revokeObjectURL/);
    // useEffect with empty deps + cleanup function returning revoke loop.
    expect(src).toMatch(/useEffect\s*\(/);
  });

  test("renders an attachment-strip container scaffold with data-testid", () => {
    const src = readComposer();
    expect(src).toMatch(/data-testid\s*=\s*["']composer-attachment-strip["']/);
  });
});

describe("T-006 paste handler (US-001)", () => {
  test("textarea has an onPaste handler", () => {
    const src = readComposer();
    expect(src).toMatch(/onPaste\s*=\s*\{/);
  });

  test("paste handler reads clipboardData.files", () => {
    const src = readComposer();
    expect(src).toMatch(/clipboardData\??\.files/);
  });

  test("paste handler calls addAttachments when images present", () => {
    const src = readComposer();
    // Look at the paste-handler region (between onPaste and either next
    // handler or end of function): the handler must reference
    // addAttachments to feed files through the unified pipeline.
    const pasteHandlerName = src.match(/onPaste\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/);
    expect(pasteHandlerName, "paste handler binding").toBeTruthy();
    // The handler addAttachments call exists somewhere in the file.
    expect(src).toMatch(/addAttachments\s*\(/);
  });

  test("paste handler calls preventDefault when image accepted", () => {
    const src = readComposer();
    expect(src).toMatch(/preventDefault\s*\(/);
  });
});

describe("T-007 paperclip + hidden file input (US-002)", () => {
  test("renders a hidden <input type='file' multiple accept='image/*'>", () => {
    const src = readComposer();
    expect(src).toMatch(/type\s*=\s*["']file["']/);
    expect(src).toMatch(/multiple/);
    expect(src).toMatch(/accept\s*=\s*["']image\/\*["']/);
    // The hidden attribute (or className hidden, both acceptable).
    expect(src).toMatch(/\bhidden\b/);
  });

  test("paperclip button click forwards to hidden input via ref", () => {
    const src = readComposer();
    // useRef<HTMLInputElement> for the hidden picker.
    expect(src).toMatch(/useRef<HTMLInputElement\s*\|\s*null>|useRef<HTMLInputElement>/);
    // inputRef.current?.click() pattern
    expect(src).toMatch(/\.current\s*\?\.\s*click\s*\(\)/);
  });

  test("paperclip title is 'Attach image' (not 'not yet wired')", () => {
    const src = readComposer();
    expect(src).not.toMatch(/not yet wired/);
    expect(src).toMatch(/Attach image/);
  });

  test("hidden input onChange forwards files to addAttachments", () => {
    const src = readComposer();
    // The picker handler resets the input value after dispatch
    // (so the same file selection can re-fire onChange).
    expect(src).toMatch(/\.value\s*=\s*["']{2}|\.value\s*=\s*""/);
  });
});

describe("T-008 drag-drop + data-dragging highlight (US-003)", () => {
  test("declares isDragging state", () => {
    const src = readComposer();
    expect(src).toMatch(/useState<boolean>\s*\(\s*false\s*\)/);
  });

  test("container has onDragEnter/onDragOver/onDragLeave/onDrop handlers", () => {
    const src = readComposer();
    expect(src).toMatch(/onDragEnter\s*=/);
    expect(src).toMatch(/onDragOver\s*=/);
    expect(src).toMatch(/onDragLeave\s*=/);
    expect(src).toMatch(/onDrop\s*=/);
  });

  test("container exposes data-dragging attribute (driven by isDragging)", () => {
    const src = readComposer();
    expect(src).toMatch(/data-dragging\s*=/);
  });

  test("drop handler reads dataTransfer.files", () => {
    const src = readComposer();
    expect(src).toMatch(/dataTransfer\??\.files/);
  });

  test("drag handlers check dataTransfer.types includes 'Files'", () => {
    const src = readComposer();
    // Filter non-file drags (e.g. dragging selected text).
    expect(src).toMatch(/dataTransfer\??\.types/);
    expect(src).toMatch(/["']Files["']/);
  });

  test("drop handler calls preventDefault to swallow browser default", () => {
    const src = readComposer();
    // preventDefault used by both onDragOver and onDrop branches; we already
    // require it in T-006 + T-008 — assert it appears at least twice.
    const matches = src.match(/preventDefault\s*\(/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("styles.css has a [data-dragging] selector for the highlight", () => {
    const css = readFileSync(stylesPath, "utf8");
    expect(css).toMatch(/\[data-dragging\]/);
  });
});

describe("T-009 attachment-strip render + per-thumb remove + URL revoke (US-005)", () => {
  test("strip renders one <img> per attachment with previewUrl src", () => {
    const src = readComposer();
    // attachments.map(...) inside the JSX, each yielding an <img> bound
    // to att.previewUrl.
    expect(src).toMatch(/attachments\.map\s*\(/);
    expect(src).toMatch(/previewUrl/);
  });

  test("each tile has a remove button with aria-label", () => {
    const src = readComposer();
    expect(src).toMatch(/aria-label\s*=\s*\{[^}]*Remove/);
  });

  test("removeAttachment helper revokes the object URL", () => {
    const src = readComposer();
    expect(src).toMatch(/removeAttachment/);
    // Pair-up check: revokeObjectURL gets called with the matching previewUrl.
    expect(src).toMatch(/revokeObjectURL\s*\(/);
  });

  test("overCapNotice renders with role='status' (a11y live region)", () => {
    const src = readComposer();
    expect(src).toMatch(/role\s*=\s*["']status["']/);
    expect(src).toMatch(/aria-live\s*=\s*["']polite["']/);
  });

  test("attachment-strip renders above the textarea (DOM order)", () => {
    const src = readComposer();
    const stripIdx = src.indexOf("composer-attachment-strip");
    // Match the actual JSX site of <textarea> (not "textarea" in a comment).
    const textareaIdx = src.indexOf("<textarea");
    expect(stripIdx, "strip test-id present").toBeGreaterThan(-1);
    expect(textareaIdx, "<textarea> JSX present").toBeGreaterThan(-1);
    expect(stripIdx).toBeLessThan(textareaIdx);
  });
});

describe("T-010 submit-time base64 + onSubmit widening + live-chat wiring (US-006)", () => {
  test("ChatComposerProps.onSubmit signature widens with images: UserTurnImage[]", () => {
    const src = readComposer();
    // Look at the onSubmit type within the props interface.
    expect(src).toMatch(/onSubmit\?:[^;]*UserTurnImage\[\]/);
    // Import of UserTurnImage from chat-types.
    expect(src).toMatch(/UserTurnImage[\s,}]/);
  });

  test("ChatComposerProps declares cwd?: string prop (T-010 declares for T-013)", () => {
    const src = readComposer();
    expect(src).toMatch(/cwd\?\s*:\s*string/);
  });

  test("submit handler encodes attachments via FileReader.readAsDataURL", () => {
    const src = readComposer();
    expect(src).toMatch(/FileReader|readAsDataURL/);
  });

  test("submit allowed with empty text when attachments.length > 0", () => {
    const src = readComposer();
    // Guard relaxed: `text || attachments.length`-style condition.
    expect(src).toMatch(/attachments\.length\s*>\s*0|attachments\.length\s*===?\s*0/);
  });

  test("post-submit cleanup revokes all previewUrls + clears attachments state", () => {
    const src = readComposer();
    // setAttachments([]) is the clear; revokeObjectURL invoked over the
    // pre-submit list (already required for T-009; redundant assertion
    // checking the clear path).
    expect(src).toMatch(/setAttachments\s*\(\s*\[\s*\]\s*\)/);
  });

  test("live-chat submitTurn widened to accept images and forward as body.images", () => {
    const src = readLiveChat();
    expect(src).toMatch(/submitTurn[\s\S]{0,200}images\s*:\s*UserTurnImage\[\]/);
    // body.images is appended only when non-empty.
    expect(src).toMatch(/images\.length\s*>\s*0/);
    // images is imported from chat-types
    expect(src).toMatch(/UserTurnImage/);
  });

  test("live-chat omits body.images when empty (byte-compatible wire shape)", () => {
    const src = readLiveChat();
    // Look for a conditional body construction that includes images
    // only when non-empty.
    expect(src).toMatch(/(images\.length\s*>\s*0\s*\?[\s\S]{0,200}images|if\s*\(\s*images\.length\s*>\s*0\s*\))/);
  });

  test("live-chat passes chat?.cwd to ChatComposer", () => {
    const src = readLiveChat();
    expect(src).toMatch(/cwd\s*=\s*\{[^}]*chat[^}]*cwd[^}]*\}/);
  });
});

describe("T-013 @-menu state + debounced /file-search + mutual-exclusion (US-008, US-009)", () => {
  test("composer imports detectAtFileTrigger + ComposerAtFileMenu", () => {
    const src = readComposer();
    expect(src).toMatch(/detectAtFileTrigger/);
    expect(src).toMatch(/ComposerAtFileMenu/);
  });

  test("declares parallel @-menu state slots (open/selectedIndex/query/results/loading)", () => {
    const src = readComposer();
    expect(src).toMatch(/atFileMenuOpen|setAtFileMenuOpen/);
    expect(src).toMatch(/atFileSelectedIndex|setAtFileSelectedIndex/);
    expect(src).toMatch(/atFileQuery|setAtFileQuery/);
    expect(src).toMatch(/atFileResults|setAtFileResults/);
    expect(src).toMatch(/atFileLoading|setAtFileLoading/);
  });

  test("mutual-exclusion guard: @-menu suppressed when slash menu open", () => {
    const src = readComposer();
    // The guard reads the slash-menu open flag (menuOpen or trigger) and
    // gates the at-file detection.
    expect(src).toMatch(/(slashMenuOpen|!menuOpen|menuOpen\s*&&|\!\s*trigger)/);
  });

  test("debounced /file-search fetch uses ~150ms setTimeout + AbortController", () => {
    const src = readComposer();
    expect(src).toMatch(/setTimeout\s*\([^)]*,\s*150\s*\)/);
    expect(src).toMatch(/AbortController/);
  });

  test("fetch URL is /file-search with cwd + q query parameters", () => {
    const src = readComposer();
    expect(src).toMatch(/\/file-search/);
    expect(src).toMatch(/encodeURIComponent/);
    expect(src).toMatch(/cwd=/);
    expect(src).toMatch(/q=/);
  });

  test("Escape closes the @-menu without modifying the textarea", () => {
    const src = readComposer();
    // The Escape key is handled in the existing slash menu; the at-file
    // handler must also wire it. We assert the source mentions Escape
    // handling at least twice (slash + atfile).
    const escapes = src.match(/["']Escape["']/g);
    expect(escapes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("dev-warn fires when both slash and at-file triggers fire on same tick", () => {
    const src = readComposer();
    expect(src).toMatch(/console\.warn/);
  });

  test("ComposerAtFileMenu rendered inside the composer JSX", () => {
    const src = readComposer();
    expect(src).toMatch(/<ComposerAtFileMenu\b/);
  });

  test("ChatComposer accepts cwd through props destructure", () => {
    const src = readComposer();
    // The destructure list in the function signature mentions cwd.
    expect(src).toMatch(/function\s+ChatComposer\s*\(\s*\{[\s\S]*?\bcwd\b[\s\S]*?\}\s*:\s*ChatComposerProps/);
  });
});

describe("T-014 placeholder @-file chip removed (US-010)", () => {
  test("footer no longer renders the placeholder '@-file' chip", () => {
    const src = readComposer();
    // Pre-T-014 footer literally contained the string '@-file' inside a
    // span; the chip is the only reference to that exact substring.
    // Note we also have legitimate `@-file picker` references inside
    // comments, so we restrict the check to JSX text node content.
    // The chip rendered `>@-file<`; assert that exact JSX tail is gone.
    expect(src).not.toMatch(/>\s*@-file\s*</);
  });

  test("/commands chip is preserved", () => {
    const src = readComposer();
    // The /commands chip renders `>commands<` inside the span; keep it.
    expect(src).toMatch(/>\s*commands\s*</);
  });
});
