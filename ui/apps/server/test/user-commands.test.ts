import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  discoverUserSlashCommands,
  mergeSlashCommands,
} from "../src/process-manager/jsonl/user-commands.ts";
import type { WireSlashCommand } from "../src/chat-protocol/messages.ts";

// Two fake claude roots: a project (cwd/.claude) and a user home (home/.claude).
let cwd: string;
let home: string;

function skill(root: string, dir: string, frontmatter: string): void {
  const d = join(root, ".claude", "skills", dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "SKILL.md"), `---\n${frontmatter}\n---\nbody\n`);
}

function command(root: string, name: string, frontmatter?: string): void {
  const d = join(root, ".claude", "commands");
  mkdirSync(d, { recursive: true });
  const fm = frontmatter ? `---\n${frontmatter}\n---\n` : "";
  writeFileSync(join(d, `${name}.md`), `${fm}do the thing\n`);
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "loom-cwd-"));
  home = mkdtempSync(join(tmpdir(), "loom-home-"));

  // user-invocable skill (the /weave case) — MUST surface.
  skill(
    home,
    "weave",
    [
      "name: weave",
      "description: Loom lifecycle orchestrator. Runs Spec, Design, Plan.",
      "user-invocable: true",
      "disable-model-invocation: true",
      "argument-hint: [project-name]",
    ].join("\n"),
  );
  // model-only skill — MUST be skipped (no user-invocable: true).
  skill(home, "internal", ["name: internal", "description: model only."].join("\n"));
  // custom project command — always a user command.
  command(cwd, "deploy", "description: ship it\nargument-hint: [env]");
  // project skill that shadows a user skill of the same name.
  skill(cwd, "weave", ["name: weave", "description: PROJECT override.", "user-invocable: true"].join("\n"));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("discoverUserSlashCommands", () => {
  it("surfaces user-invocable skills and skips model-only ones", () => {
    const cmds = discoverUserSlashCommands(cwd, home);
    const names = cmds.map((c) => c.name).sort();
    expect(names).toContain("weave");
    expect(names).toContain("deploy");
    expect(names).not.toContain("internal");
  });

  it("parses colon-bearing descriptions and the argument hint", () => {
    const weave = discoverUserSlashCommands(cwd, home).find((c) => c.name === "weave")!;
    // Project scope wins the dedupe over the user-global copy.
    expect(weave.description).toBe("PROJECT override.");
    expect(weave.kind).toBe("skill");
    const deploy = discoverUserSlashCommands(cwd, home).find((c) => c.name === "deploy")!;
    expect(deploy.description).toBe("ship it");
    expect(deploy.argumentHint).toBe("[env]");
    expect(deploy.kind).toBe("command");
  });

  it("returns [] for a cwd/home with no .claude dirs (no throw)", () => {
    const empty = mkdtempSync(join(tmpdir(), "loom-empty-"));
    expect(discoverUserSlashCommands(empty, empty)).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("mergeSlashCommands", () => {
  const primary: WireSlashCommand[] = [
    { name: "forge", description: "from skill_listing", argumentHint: "", kind: "skill" },
  ];
  const extra: WireSlashCommand[] = [
    { name: "weave", description: "disk", argumentHint: "", kind: "skill" },
    { name: "forge", description: "disk dup", argumentHint: "", kind: "skill" },
  ];

  it("appends disk commands the model-facing catalog lacks", () => {
    const merged = mergeSlashCommands(primary, extra);
    expect(merged.map((c) => c.name)).toEqual(["forge", "weave"]);
  });

  it("lets primary win on name collision (keeps claude's description)", () => {
    const merged = mergeSlashCommands(primary, extra);
    expect(merged.find((c) => c.name === "forge")!.description).toBe("from skill_listing");
  });
});
