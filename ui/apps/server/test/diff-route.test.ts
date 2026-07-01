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
      `http://x/diff?worktreePath=${encodeURIComponent(root)}`,
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

  test("falls back to HEAD when no trunk exists in a repo", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-nobase-"));
    tmpDirs.push(root);

    // Repo whose only branch is "trunk" — no main/master, no remote. The
    // default-branch resolver finds no trunk, so merge-base collapses to HEAD
    // and we still surface the uncommitted edit rather than erroring.
    fs.mkdirSync(root, { recursive: true });
    git(root, ["init", "-q", "-b", "trunk"]);
    git(root, ["config", "user.email", "t@x"]);
    git(root, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "init"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha edited\n");

    const res = await call(
      mount()["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(root)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ diff: string }> };
    expect(body.sections.length).toBe(1);
    expect(body.sections[0]!.diff).toMatch(/a\.txt/);
  });

  test("default branch renamed (main → master) still resolves a trunk via the remote-tracking ref", async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-remote-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-renamed-"));
    tmpDirs.push(remote, root);

    // Bare remote with a "main" default, cloned into root.
    git(remote, ["init", "-q", "--bare", "-b", "main"]);
    initRepo(root);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "init"]);
    git(root, ["remote", "add", "origin", remote]);
    git(root, ["push", "-q", "-u", "origin", "main"]);
    git(root, ["remote", "set-head", "origin", "main"]); // origin/HEAD → main

    // Rename the local default out from under origin/HEAD: main → master. Now
    // `origin/HEAD` still names the stale "main" (no local ref), but the
    // committed work plus an uncommitted edit must still surface — resolved
    // via the `origin/main` remote-tracking ref, not a HEAD-only fallback.
    git(root, ["branch", "-q", "-m", "main", "master"]);
    fs.writeFileSync(path.join(root, "feature.txt"), "committed on master\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "work after rename"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha edited after rename\n");

    const res = await call(
      mount()["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(root)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ diff: string }> };
    const diff = body.sections[0]!.diff;
    expect(diff).toMatch(/feature\.txt/); // committed work surfaces
    expect(diff).toMatch(/alpha edited after rename/); // uncommitted edit too
  });

  test("a branch diverged from the trunk shows its committed work, not just uncommitted edits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffroute-diverged-"));
    tmpDirs.push(root);

    // main: baseline commit.
    initRepo(root);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "init"]);

    // Fork a feature branch and COMMIT a new file there.
    git(root, ["checkout", "-q", "-b", "feature"]);
    fs.writeFileSync(path.join(root, "feature.txt"), "feature work\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "feature commit"]);

    // Advance main past the fork point so a naive `git diff main` would show
    // reverse noise. (Done while the tree is clean to avoid carrying edits.)
    git(root, ["checkout", "-q", "main"]);
    fs.writeFileSync(path.join(root, "b.txt"), "main moved on\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "main advances"]);

    // Back on feature: an uncommitted edit on top of the committed work.
    git(root, ["checkout", "-q", "feature"]);
    fs.writeFileSync(path.join(root, "a.txt"), "alpha edited on feature\n");

    const res = await call(
      mount()["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(root)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: Array<{ diff: string }> };
    const diff = body.sections[0]!.diff;
    // Committed branch work surfaces…
    expect(diff).toMatch(/feature\.txt/);
    // …alongside the uncommitted edit…
    expect(diff).toMatch(/alpha edited on feature/);
    // …but main's post-fork commit must NOT appear (merge-base, not main-tip,
    // is the base — so no reverse-diff noise).
    expect(diff).not.toMatch(/b\.txt/);
  });
});
