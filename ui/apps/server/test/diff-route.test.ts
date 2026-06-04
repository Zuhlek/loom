import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { mountDiffRoute } from "../src/routes/diff.ts";

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@x"]);
  git(dir, ["config", "user.name", "t"]);
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

type Handler = (req: Request, url: URL) => Response | Promise<Response>;
function mount(): Record<string, Handler> {
  const routes: Record<string, Handler> = {};
  mountDiffRoute(routes);
  return routes;
}
function call(handler: Handler, url: string) {
  return handler(new Request(url), new URL(url));
}

describe("GET /diff — total branch/workspace diff", () => {
  test("missing worktreePath → 400", async () => {
    const res = await call(mount()["/diff"]!, "http://x/diff");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("missing worktreePath");
  });

  test("aggregates the root repo and an independent nested repo, labelling by relative path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-"));
    tmpDirs.push(root);

    // Root repo: commit a.txt on main, then modify it (uncommitted).
    initRepo(root);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "init"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha edited\n");
    // An untracked new file — agents create these constantly; the total
    // diff must surface it even though `git diff` alone would not.
    fs.writeFileSync(path.join(root, "fresh.txt"), "brand new\n");

    // Nested repo at root/sub: commit c.txt, then modify it.
    const sub = path.join(root, "sub");
    initRepo(sub);
    fs.writeFileSync(path.join(sub, "c.txt"), "charlie\n");
    git(sub, ["add", "-A"]);
    git(sub, ["commit", "-q", "-m", "init"]);
    fs.writeFileSync(path.join(sub, "c.txt"), "charlie edited\n");

    // A second nested repo with a clean tree — should be omitted.
    const clean = path.join(root, "clean");
    initRepo(clean);
    fs.writeFileSync(path.join(clean, "x.txt"), "x\n");
    git(clean, ["add", "-A"]);
    git(clean, ["commit", "-q", "-m", "init"]);

    const res = await call(
      mount()["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(root)}&base=main`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ label: string; diff: string; kind: string }> };

    // Clean repo omitted → exactly two sections.
    expect(body.sections.length).toBe(2);

    const rootSection = body.sections.find((s) => s.label === "");
    const subSection = body.sections.find((s) => s.label === "sub");
    expect(rootSection).toBeDefined();
    expect(subSection).toBeDefined();
    expect(rootSection!.diff).toMatch(/a\.txt/);
    // The untracked new file is included as an add-diff.
    expect(rootSection!.diff).toMatch(/fresh\.txt/);
    expect(subSection!.diff).toMatch(/c\.txt/);
    // The root's diff must not leak the nested repo's files (sub/ is
    // untracked from the root's perspective).
    expect(rootSection!.diff).not.toMatch(/c\.txt/);
  });

  test("falls back to HEAD when the base ref is absent in a repo", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-nobase-"));
    tmpDirs.push(root);

    // Repo on a branch that is NOT "main"; commit then modify.
    fs.mkdirSync(root, { recursive: true });
    git(root, ["init", "-q", "-b", "trunk"]);
    git(root, ["config", "user.email", "t@x"]);
    git(root, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "init"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha edited\n");

    // base=main does not exist → handler falls back to HEAD, surfacing
    // the uncommitted edit rather than erroring.
    const res = await call(
      mount()["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(root)}&base=main`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ diff: string }> };
    expect(body.sections.length).toBe(1);
    expect(body.sections[0]!.diff).toMatch(/a\.txt/);
  });
});
