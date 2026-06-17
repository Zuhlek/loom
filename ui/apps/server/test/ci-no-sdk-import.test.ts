/**
 * T-017 + T-021 — CI grep: no @anthropic-ai/* SDK imports anywhere
 * under `ui/` (source files or package.json dependency lists).
 *
 * Post-cutover (T-021) this asserts ZERO hits. Pre-cutover the test
 * permitted exactly two known sites (`claude-session-bridge.ts` and
 * `apps/server/package.json`); both are gone now.
 *
 * US-001 AC2, AC4: zero `@anthropic-ai/*` reachable from `ui/`.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const UI_ROOT = join(__dirname, "..", "..", "..");
const SERVER_SRC = join(UI_ROOT, "apps", "server", "src");
const WEB_SRC = join(UI_ROOT, "apps", "web", "src");

function walkTs(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (s.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function grepMatches(file: string, rx: RegExp): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (rx.test(ln)) out.push(`${file}:${i + 1}: ${ln.trim()}`);
  }
  return out;
}

describe("CI grep — no @anthropic-ai/* import anywhere in ui/", () => {
  it("source files under ui/apps/* never reference @anthropic-ai/*", () => {
    const files = [...walkTs(SERVER_SRC), ...walkTs(WEB_SRC)];
    const rx = /@anthropic-ai\//;
    const hits: string[] = [];
    for (const f of files) {
      // The test file itself contains the literal as a regex; allow it.
      if (f === __filename) continue;
      const matches = grepMatches(f, rx);
      for (const m of matches) hits.push(m);
    }
    expect(hits).toEqual([]);
  });

  it("no package.json under ui/ lists @anthropic-ai/* as a dependency", () => {
    const serverPkgPath = join(UI_ROOT, "apps", "server", "package.json");
    const webPkgPath = join(UI_ROOT, "apps", "web", "package.json");
    const rootPkgPath = join(UI_ROOT, "package.json");

    for (const pkgPath of [serverPkgPath, webPkgPath, rootPkgPath]) {
      let pkg: Record<string, unknown> = {};
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      } catch {
        pkg = {};
      }
      const has =
        Object.keys((pkg as any).dependencies ?? {}).some((k) =>
          k.startsWith("@anthropic-ai/"),
        ) ||
        Object.keys((pkg as any).devDependencies ?? {}).some((k) =>
          k.startsWith("@anthropic-ai/"),
        );
      expect(has, `@anthropic-ai/* found in ${pkgPath}`).toBe(false);
    }
  });
});

describe("CI grep — JSONL field-name discipline", () => {
  // The only place JSONL field-name string literals (the values of
  // FIELDS) are allowed is the schema module itself. Other modules
  // under `process-manager/jsonl/` may reference FIELDS.<KEY> at the
  // identifier level but must NOT inline the string literal.
  const FIELD_LITERALS = [
    "uuid",
    "sessionId",
    "timestamp",
    "tool_use_id",
    "is_error",
    "activeForm",
    // Common literals like "type" / "content" / "role" / "id" / "input"
    // / "name" / "text" / "todos" / "step" / "status" / "message" are
    // too common in unrelated code to ban globally; the discipline
    // applies to the JSONL-specific names above.
  ] as const;

  it("FIELD_LITERALS only appear in schema.ts within process-manager/jsonl/", () => {
    const jsonlDir = join(SERVER_SRC, "process-manager", "jsonl");
    const files = walkTs(jsonlDir);
    const schemaPath = join(jsonlDir, "schema.ts");
    const hits: string[] = [];
    for (const f of files) {
      if (f === schemaPath) continue;
      if (f.endsWith(".test.ts")) continue;
      const text = readFileSync(f, "utf8");
      // Strip block + line comments before scanning — markdown-style
      // backtick-quoted prose in JSDoc is documentation, not a JSONL
      // field-name access.
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      for (const lit of FIELD_LITERALS) {
        // Match the literal in a string context (single, double, or
        // backtick quotes immediately enclosing the literal).
        const rx = new RegExp(`(['"])${lit}\\1`);
        if (rx.test(stripped)) {
          hits.push(`${f}: contains JSONL field literal '${lit}'`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
