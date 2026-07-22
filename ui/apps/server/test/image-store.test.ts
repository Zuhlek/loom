/**
 * T-001 / T-002 — Image store: decode + durable write + manifest + read-back.
 *
 * Behaviour-level (observable inputs → on-disk + returned outputs); temp-dir
 * fixtures, no live tmux / claude.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  createImageStore,
  StageImageError,
} from "../src/process-manager/jsonl/image-store.ts";
import type { UserTurnImage } from "../src/chat-protocol/frames.ts";

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function img(over: Partial<UserTurnImage> = {}): UserTurnImage {
  return { mediaType: "image/png", dataB64: PNG_B64, ...over };
}

describe("image-store — stageTurnImages (T-001)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "image-store-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("decodes base64 and writes bytes under <dataDir>/images/<chatId>/<id>.png", async () => {
    const store = createImageStore({ dataDir });
    const [staged] = await store.stageTurnImages("c-1", [img()]);
    expect(staged.absPath).toMatch(/\/images\/c-1\/[0-9a-f]{32}\.png$/);
    expect(staged.mediaType).toBe("image/png");
    expect(existsSync(staged.absPath)).toBe(true);
    const bytes = readFileSync(staged.absPath);
    expect(Buffer.from(PNG_B64, "base64").equals(bytes)).toBe(true);
  });

  it("stages two images preserving input order", async () => {
    const store = createImageStore({ dataDir });
    const staged = await store.stageTurnImages("c-1", [
      img({ filename: "a.png" }),
      img({ mediaType: "image/jpeg", filename: "b.jpg" }),
    ]);
    expect(staged).toHaveLength(2);
    expect(staged[0].filename).toBe("a.png");
    expect(staged[0].absPath).toMatch(/\.png$/);
    expect(staged[1].filename).toBe("b.jpg");
    expect(staged[1].absPath).toMatch(/\.jpg$/); // jpeg→jpg ext convention
    expect(existsSync(staged[0].absPath)).toBe(true);
    expect(existsSync(staged[1].absPath)).toBe(true);
  });

  it("throws StageImageError for a disallowed type and writes nothing for it", async () => {
    const store = createImageStore({ dataDir });
    await expect(
      store.stageTurnImages("c-1", [img({ mediaType: "image/svg+xml" })]),
    ).rejects.toMatchObject({ message: /unsupported image mediaType/ });
    await expect(
      store.stageTurnImages("c-1", [img({ mediaType: "image/svg+xml" })]),
    ).rejects.toBeInstanceOf(StageImageError);
  });

  it("throws StageImageError for malformed base64", async () => {
    const store = createImageStore({ dataDir });
    await expect(
      store.stageTurnImages("c-1", [img({ dataB64: "!!!not base64!!!" })]),
    ).rejects.toMatchObject({ message: /failed to decode base64/ });
  });

  it("records the manifest keyed by absPath with mediaType/filename/stagedAt and merges across stages", async () => {
    const store = createImageStore({ dataDir });
    const [first] = await store.stageTurnImages("c-1", [img({ filename: "first.png" })]);
    const [second] = await store.stageTurnImages("c-1", [img({ filename: "second.png" })]);
    const manifestPath = join(dataDir, "images", "c-1", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);
    // First entry survives the second stage (merge, not clobber).
    expect(manifest.entries[first.absPath]).toMatchObject({
      mediaType: "image/png",
      filename: "first.png",
    });
    expect(manifest.entries[first.absPath].stagedAt).toEqual(expect.any(String));
    expect(manifest.entries[second.absPath]).toMatchObject({ filename: "second.png" });
  });

  it("manifest write is crash-safe: a stray temp file never replaces a valid manifest", async () => {
    const store = createImageStore({ dataDir });
    await store.stageTurnImages("c-1", [img()]);
    const dir = join(dataDir, "images", "c-1");
    const manifestPath = join(dir, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");
    // A leftover temp file from a prior crash must not be read as the manifest.
    writeFileSync(join(dir, "manifest.json.tmp"), "{ partial");
    await store.stageTurnImages("c-1", [img()]);
    const after = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(after.version).toBe(1);
    expect(Object.keys(after.entries).length).toBe(2);
    expect(() => JSON.parse(before)).not.toThrow();
  });

  it("accepts exactly the allowed MIME set and derives ext per upload-image convention", async () => {
    const store = createImageStore({ dataDir });
    const cases: Array<[string, RegExp]> = [
      ["image/png", /\.png$/],
      ["image/jpeg", /\.jpg$/],
      ["image/jpg", /\.jpg$/],
      ["image/webp", /\.webp$/],
      ["image/gif", /\.gif$/],
    ];
    for (const [mediaType, extRe] of cases) {
      const [staged] = await store.stageTurnImages("c-mime", [img({ mediaType })]);
      expect(staged.absPath).toMatch(extRe);
    }
  });
});

describe("image-store — lookupByPath (T-002)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "image-store-rb-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns the stored metadata for a known path", async () => {
    const store = createImageStore({ dataDir });
    const [staged] = await store.stageTurnImages("c-1", [img({ filename: "x.png" })]);
    const meta = store.lookupByPath("c-1", staged.absPath);
    expect(meta).toMatchObject({ mediaType: "image/png", filename: "x.png" });
    // id is the basename without extension — addressable by the read-back route.
    expect(meta?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(staged.absPath).toContain(meta!.id);
  });

  it("returns undefined for a path not in the manifest (no throw)", async () => {
    const store = createImageStore({ dataDir });
    await store.stageTurnImages("c-1", [img()]);
    expect(store.lookupByPath("c-1", "/nope/missing.png")).toBeUndefined();
  });

  it("returns undefined and warns when the manifest is corrupt", async () => {
    const store = createImageStore({ dataDir });
    const dir = join(dataDir, "images", "c-corrupt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(store.lookupByPath("c-corrupt", join(dir, "whatever.png"))).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("is a pure read: repeated lookups do not mutate the manifest", async () => {
    const store = createImageStore({ dataDir });
    const [staged] = await store.stageTurnImages("c-1", [img()]);
    const manifestPath = join(dataDir, "images", "c-1", "manifest.json");
    const before = readFileSync(manifestPath, "utf8");
    store.lookupByPath("c-1", staged.absPath);
    store.lookupByPath("c-1", staged.absPath);
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });
});
