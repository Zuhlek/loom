/**
 * fabric-phase-files: phase classification & partitioning.
 *
 * Each phase has a predefined set of files/folders. Anything that
 * doesn't match a known pattern falls into the `misc` bucket so we can
 * see mapping gaps at a glance in the file tree drawer.
 */
import { describe, expect, test } from "vitest";
import {
  classifyPath,
  partitionByPhase,
  PHASE_GROUP_ORDER,
  PIPELINE_PATH,
} from "../src/components/fabric/fabric-phase-files";
import type { FabricTreeEntry } from "../src/components/fabric/FabricFileTree";

function file(path: string): FabricTreeEntry {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return { path, name, isDirectory: false, size: 0, mtime: "" };
}
function dir(path: string): FabricTreeEntry {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return { path, name, isDirectory: true, size: 0, mtime: "" };
}

describe("classifyPath", () => {
  test("spec artifacts route to spec", () => {
    for (const p of [
      "seed.md",
      "idea.md",
      "repo-context.md",
      "spec.md",
      "decisions.md",
    ]) {
      expect(classifyPath(p)).toBe("spec");
    }
  });

  test("design artifacts route to design (including mockup/ tree)", () => {
    expect(classifyPath("design.md")).toBe("design");
    expect(classifyPath("mockup/page.html")).toBe("design");
    expect(classifyPath("mockup/nested/asset.svg")).toBe("design");
  });

  test("plan artifacts route to plan (T-NNN.md, not T-NNN.done.md)", () => {
    expect(classifyPath("plan.md")).toBe("plan");
    expect(classifyPath("task.md")).toBe("plan");
    expect(classifyPath("tests.md")).toBe("plan");
    expect(classifyPath("tasks/T-001.md")).toBe("plan");
    expect(classifyPath("tasks/T-042.md")).toBe("plan");
  });

  test("build artifacts route to build", () => {
    expect(classifyPath("board.md")).toBe("build");
    expect(classifyPath("tasks/T-001.done.md")).toBe("build");
    expect(classifyPath("tasks/T-001.test-log.txt")).toBe("build");
    expect(classifyPath("test-report.md")).toBe("build");
    expect(classifyPath("smoke-report.md")).toBe("build");
    expect(classifyPath("smoke-screenshots/home.png")).toBe("build");
    expect(classifyPath("orchestrator/log/build.md")).toBe("build");
    expect(classifyPath("events.jsonl")).toBe("build");
    expect(classifyPath("develop-log.md")).toBe("build");
    expect(classifyPath("artifacts.json")).toBe("build");
    expect(classifyPath(".locks/T-001.lock/owner")).toBe("build");
    expect(classifyPath(".lock/owner")).toBe("build");
  });

  test("review artifacts route to review", () => {
    expect(classifyPath("review.md")).toBe("review");
    expect(classifyPath("quality-review.md")).toBe("review");
    expect(classifyPath("feedback.md")).toBe("review");
  });

  test("unknown paths fall through to misc", () => {
    expect(classifyPath("superseded/2026-05-14T07-56-10Z/spec.md")).toBe("misc");
    expect(classifyPath("README.md")).toBe("misc");
    expect(classifyPath("random/folder/file.txt")).toBe("misc");
  });
});

describe("partitionByPhase", () => {
  test("groups files into per-phase buckets in PHASE_GROUP_ORDER", () => {
    expect(PHASE_GROUP_ORDER).toEqual([
      "spec",
      "design",
      "plan",
      "build",
      "review",
      "misc",
    ]);
  });

  test("includes directory entries in every phase bucket that has a descendant", () => {
    const entries: FabricTreeEntry[] = [
      dir("tasks"),
      file("tasks/T-001.md"),       // plan
      file("tasks/T-001.done.md"),  // build
      file("plan.md"),
      file("board.md"),
    ];
    const buckets = partitionByPhase(entries);

    // tasks/ appears in plan AND build, because both phases own files there.
    expect(buckets.plan.some((e) => e.path === "tasks" && e.isDirectory)).toBe(true);
    expect(buckets.build.some((e) => e.path === "tasks" && e.isDirectory)).toBe(true);

    // but only the relevant files are nested inside each phase.
    expect(buckets.plan.map((e) => e.path).sort()).toEqual([
      "plan.md",
      "tasks",
      "tasks/T-001.md",
    ]);
    expect(buckets.build.map((e) => e.path).sort()).toEqual([
      "board.md",
      "tasks",
      "tasks/T-001.done.md",
    ]);
  });

  test("unknown files end up in misc so mapping gaps stay visible", () => {
    const entries: FabricTreeEntry[] = [
      file("spec.md"),
      file("totally-new-artifact.md"),
      dir("superseded"),
      file("superseded/2026-05-14/spec.md"),
    ];
    const buckets = partitionByPhase(entries);
    expect(buckets.misc.map((e) => e.path).sort()).toEqual([
      "superseded",
      "superseded/2026-05-14/spec.md",
      "totally-new-artifact.md",
    ]);
    expect(buckets.spec.map((e) => e.path)).toEqual(["spec.md"]);
  });

  test("pipeline.md is excluded from every bucket (renderer pins it at the top)", () => {
    expect(PIPELINE_PATH).toBe("pipeline.md");
    const entries: FabricTreeEntry[] = [
      file("pipeline.md"),
      file("spec.md"),
      file("totally-new-artifact.md"),
    ];
    const buckets = partitionByPhase(entries);
    for (const id of PHASE_GROUP_ORDER) {
      expect(buckets[id].some((e) => e.path === "pipeline.md")).toBe(false);
    }
    // Other files still classify normally.
    expect(buckets.spec.map((e) => e.path)).toEqual(["spec.md"]);
    expect(buckets.misc.map((e) => e.path)).toEqual(["totally-new-artifact.md"]);
  });

  test("empty input yields empty buckets for every group", () => {
    const buckets = partitionByPhase([]);
    for (const id of PHASE_GROUP_ORDER) {
      expect(buckets[id]).toEqual([]);
    }
  });
});
