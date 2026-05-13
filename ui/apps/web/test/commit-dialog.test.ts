/**
 * T-008 — `CommitDialog` inline composer (US-009).
 *
 * Static-source assertions over the component definition.
 *
 * Contract verified:
 *   - File exists at `src/components/diff/CommitDialog.tsx`.
 *   - Exports `CommitDialogIntent` type alias with the three
 *     intents.
 *   - Exports `CommitDialogProps` interface with the documented
 *     fields (intent, initialMessage?, initialBody?, onConfirm,
 *     onCancel, busy?, error?).
 *   - Renders a `message` textarea (required) and an optional `body`
 *     textarea.
 *   - `busy` disables the Confirm button.
 *   - `error` renders inline (the string is rendered in the JSX).
 *   - `onConfirm` is called with the shape `{ message }` (or
 *     `{ message, body }` when body is non-empty).
 *   - Cancel button wired to `onCancel`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const dialogPath = webRoot + "src/components/diff/CommitDialog.tsx";

describe("T-008 CommitDialog — file + import surface", () => {
  test("CommitDialog.tsx exists at the documented path", () => {
    expect(existsSync(dialogPath)).toBe(true);
  });

  test("imports useState from react", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/import\s+\{[^}]*\buseState\b[^}]*\}\s+from\s+["']react["']/);
  });
});

describe("T-008 CommitDialog — type exports", () => {
  test("exports CommitDialogIntent with the three intent literals", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/export\s+type\s+CommitDialogIntent\b/);
    expect(src).toMatch(/["']commit["']/);
    expect(src).toMatch(/["']commit-push["']/);
    expect(src).toMatch(/["']pr["']/);
  });

  test("exports CommitDialogProps interface with the documented fields", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+CommitDialogProps\b/);
    expect(src).toMatch(/intent\s*:\s*CommitDialogIntent\b/);
    expect(src).toMatch(/initialMessage\?\s*:\s*string/);
    expect(src).toMatch(/initialBody\?\s*:\s*string/);
    expect(src).toMatch(/onConfirm\s*:/);
    expect(src).toMatch(/onCancel\s*:\s*\(\s*\)\s*=>\s*void/);
    expect(src).toMatch(/busy\?\s*:\s*boolean/);
    expect(src).toMatch(/error\?\s*:\s*string/);
  });

  test("onConfirm has signature (input: { message: string; body?: string }) => void", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(
      /onConfirm\s*:\s*\(\s*\w+\s*:\s*\{\s*message\s*:\s*string\s*;\s*body\?\s*:\s*string\s*;?\s*\}\s*\)\s*=>\s*void/,
    );
  });

  test("exports the component CommitDialog", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/export\s+function\s+CommitDialog\b/);
  });
});

describe("T-008 CommitDialog — textareas + state", () => {
  test("renders a `message` textarea (required field)", () => {
    const src = readFileSync(dialogPath, "utf8");
    // Anchor on a <textarea> with a value bound to the message
    // state. The state setter must use a `setMessage`-style name.
    expect(src).toMatch(/<textarea\b/);
    expect(src).toMatch(/\bsetMessage\b/);
  });

  test("renders an optional `body` textarea", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/\bsetBody\b/);
  });

  test("message state seeded from initialMessage (?? \"\")", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(
      /useState[^(]*\(\s*(?:initialMessage|props\.initialMessage)\s*\?\?\s*["']{2}\s*\)/,
    );
  });

  test("body state seeded from initialBody (?? \"\")", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(
      /useState[^(]*\(\s*(?:initialBody|props\.initialBody)\s*\?\?\s*["']{2}\s*\)/,
    );
  });
});

describe("T-008 CommitDialog — confirm + cancel wiring", () => {
  test("Confirm button is disabled when busy is true", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The disabled attribute references `busy` (and may also OR
    // an empty-message guard). We require `busy` appears inside a
    // `disabled={...}` JSX attribute somewhere.
    expect(src).toMatch(/disabled=\{[^}]*\bbusy\b/);
  });

  test("Confirm button is also disabled when message is empty", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The required-field invariant: empty message disables Confirm
    // even when busy is false. Accept any of the common guard forms.
    const emptyGuard =
      /disabled=\{[^}]*message\.trim\(\)/.test(src) ||
      /disabled=\{[^}]*!\s*message/.test(src) ||
      /disabled=\{[^}]*message\s*===\s*["']{2}/.test(src) ||
      /disabled=\{[^}]*message\.length\s*===\s*0/.test(src);
    expect(emptyGuard).toBe(true);
  });

  test("Cancel button is wired to onCancel", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).toMatch(/onClick=\{\s*onCancel\s*\}/);
  });

  test("onConfirm is invoked with { message } or { message, body } shape", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The handler builds a payload object containing at minimum the
    // `message` field. Anchor on the literal `onConfirm({` call.
    expect(src).toMatch(/onConfirm\s*\(\s*\{[^}]*\bmessage\b/);
    // The body field is added conditionally — accept any shape
    // where `body` appears in the payload (either shorthand
    // `{ message, body }` or a conditional spread).
    expect(src).toMatch(/\bbody\b/);
  });
});

describe("T-008 CommitDialog — error surface", () => {
  test("error string renders inline when set", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The error message should appear inside a JSX expression — we
    // tolerate `{error}` or `{props.error}`.
    expect(src).toMatch(/\{\s*(?:error|props\.error)\s*\}/);
  });
});
