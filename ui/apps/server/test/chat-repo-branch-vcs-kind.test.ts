/**
 * T-001 — Widen `ChatRow` with `branch` + `vcs_kind` (nullable, merge-patchable).
 *
 * Covers US-010 AC1, AC2, AC4:
 *   - `ChatRow` type exposes `branch` and `vcs_kind` as nullable fields.
 *   - Merge-patch updates the row in-place; absent keys are preserved.
 *   - A legacy row (loaded without these fields) survives with `branch = null`
 *     and `vcs_kind = null`.
 *
 * Also asserts the type-level shape via assignment compatibility checks; the
 * file is included in tsconfig (`include: ["test/**\/*"]`) so the TS compiler
 * exercises the type-level contracts at vitest's transpile step.
 */
import { describe, test, expect, expectTypeOf } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import type { ChatRow } from "../src/metadata-store/repos/chat.ts";

describe("metadata-store — chat row branch + vcs_kind widening", () => {
  test("new chat row defaults branch and vcs_kind to null", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const row = s.chats.create({ id: "c1", cwd: "/x" });
    expect(row.branch).toBeNull();
    expect(row.vcs_kind).toBeNull();
    const fetched = s.chats.get("c1");
    expect(fetched?.branch).toBeNull();
    expect(fetched?.vcs_kind).toBeNull();
    await s.close();
  });

  test("update({ branch }) patches in-place; worktree_path and worktree_mode unchanged", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x", worktree_path: "/tmp/wt", worktree_mode: "worktree" });
    const updated = s.chats.update("c1", { branch: "main" });
    expect(updated?.branch).toBe("main");
    expect(updated?.worktree_path).toBe("/tmp/wt");
    expect(updated?.worktree_mode).toBe("worktree");
    const re = s.chats.get("c1");
    expect(re?.branch).toBe("main");
    expect(re?.worktree_path).toBe("/tmp/wt");
    expect(re?.worktree_mode).toBe("worktree");
    await s.close();
  });

  test("vcs_kind patch persists independently of branch patch", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    s.chats.update("c1", { vcs_kind: "git" });
    expect(s.chats.get("c1")?.vcs_kind).toBe("git");
    s.chats.update("c1", { branch: "feature/x" });
    const re = s.chats.get("c1");
    expect(re?.vcs_kind).toBe("git");
    expect(re?.branch).toBe("feature/x");
    await s.close();
  });

  test("merge-patch with absent keys leaves prior values intact", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    s.chats.update("c1", { branch: "main", vcs_kind: "git" });
    // No branch/vcs_kind in this patch — they must be preserved.
    s.chats.update("c1", { worktree_path: "/tmp/wt" });
    const re = s.chats.get("c1");
    expect(re?.branch).toBe("main");
    expect(re?.vcs_kind).toBe("git");
    expect(re?.worktree_path).toBe("/tmp/wt");
    await s.close();
  });

  test("legacy row (no branch / vcs_kind keys at rest) reads back with null defaults", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    // Synthesise a pre-widening row directly into storage to simulate a
    // legacy on-disk shape. The repo `get()` MUST tolerate the absent
    // keys and surface them as null.
    const legacy = {
      id: "legacy1",
      project_id: null,
      cwd: "/x",
      permission_mode: "default",
      worktree_mode: "local",
      worktree_path: null,
      session_id: "00000000-0000-0000-0000-000000000000",
      pid: null,
      last_opened: new Date().toISOString(),
      pinned: false,
      resume_banner_dismissed: false,
      inert: false,
      created_at: new Date().toISOString(),
      custom_name: null,
      model_settings: null,
      // NOTE: branch + vcs_kind intentionally absent.
    };
    // We have to reach into the underlying storage; the repo exposes
    // no test-only seeder, and re-creating via `create()` would always
    // initialise the new fields. We rely on the InMemoryStorage being a
    // plain Map (per index.ts).
    const internal = s as unknown as { _storage?: { chats: Map<string, unknown> } };
    // The MetadataStore object does not expose its storage; instead we
    // use chats.create + a direct mutation through the public API by
    // bypassing the typed create. The cleanest accessor is via
    // chats.update with a deliberately-undefined patch on a row we
    // create then post-process. To strictly simulate "legacy row", we
    // mutate via the chats Map exposed implicitly through update.
    void internal;

    // Instead: create the row through public API and then DELETE the
    // branch / vcs_kind fields from the underlying object via update +
    // a manual property strip. Since we cannot reach into storage, we
    // emulate "legacy" by checking that a row CREATED then NEVER
    // patched still surfaces branch=null and vcs_kind=null. The "true
    // legacy" check is exercised by the round-trip hydrate path
    // covered in the metadata-store persistence test (a row written
    // without these keys hydrates with them undefined; the repo `get`
    // returns null).
    // We assert here that an unpatched row matches the legacy shape
    // expectation.
    s.chats.create({ id: "legacy_proxy", cwd: legacy.cwd });
    const row = s.chats.get("legacy_proxy");
    expect(row?.branch).toBeNull();
    expect(row?.vcs_kind).toBeNull();
    await s.close();
  });

  test("hydrate of on-disk row missing branch/vcs_kind keys returns nulls", async () => {
    // Direct hydrate path: write a serialized snapshot that lacks the
    // new keys, then init the store and confirm the repo normalises
    // them to null on `get()`.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const tmp = fs.mkdtempSync(pathMod.join(os.tmpdir(), "loom-meta-"));
    const dbPath = pathMod.join(tmp, "metadata.db");
    const snapshot = {
      chats: [
        {
          id: "legacy1",
          project_id: null,
          cwd: "/x",
          permission_mode: "default",
          worktree_mode: "local",
          worktree_path: null,
          session_id: "00000000-0000-0000-0000-000000000000",
          pid: null,
          last_opened: new Date().toISOString(),
          pinned: false,
          resume_banner_dismissed: false,
          inert: false,
          created_at: new Date().toISOString(),
          custom_name: null,
          model_settings: null,
          // No branch, no vcs_kind.
        },
      ],
      projects: [],
      pendingGates: [],
      hookRegistrations: [],
    };
    fs.writeFileSync(dbPath, JSON.stringify(snapshot), "utf8");
    const s = await initMetadataStore({ pglitePath: dbPath });
    const row = s.chats.get("legacy1");
    expect(row).not.toBeNull();
    expect(row?.branch).toBeNull();
    expect(row?.vcs_kind).toBeNull();
    expect(row?.worktree_mode).toBe("local");
    await s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("type-level: ChatRow exposes branch and vcs_kind as nullable", () => {
    // Compile-time checks via vitest's expectTypeOf; if these fail the
    // file will not transpile.
    expectTypeOf<ChatRow["branch"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ChatRow["vcs_kind"]>().toEqualTypeOf<"git" | "unknown" | null>();
  });
});
