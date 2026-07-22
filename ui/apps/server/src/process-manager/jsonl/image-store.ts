/**
 * jsonl/image-store.ts — durable image staging + read-back for the chat
 * submit path.
 *
 * Single chokepoint that turns base64 `UserTurnImage[]` arriving on a
 * user turn into durable bytes on disk under
 * `<dataDir>/images/<chatId>/` and records a per-chat sidecar
 * `manifest.json`. Pure I/O + manifest: it knows nothing about frames
 * or tmux. The bridge (staging side) and the materializer / read-back
 * route (read side) are its only callers.
 *
 * See design `## Image store (new module)` and ADR-002 / ADR-003.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import type { UserTurnImage } from "../../chat-protocol/frames.ts";

/** Allowed MIME set, aligned with `routes/upload-image.ts`. */
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export interface StagedImage {
  /** Absolute path the bridge appends as `@<path>` to the tmux text send. */
  absPath: string;
  mediaType: string;
  filename?: string;
}

export interface StagedImageMeta {
  mediaType: string;
  filename?: string;
  stagedAt: string;
  /** Staged id (basename without extension) — lets callers build `?id=` lookups. */
  id: string;
}

interface ImageManifest {
  version: 1;
  entries: Record<string /* absPath */, StagedImageMeta>;
}

export interface ImageStore {
  /**
   * Decode + write one turn's images to `<dataDir>/images/<chatId>/`,
   * update the per-chat manifest, and return the staged absolute paths
   * in input order. Throws `StageImageError` on decode / disallowed-MIME
   * / disk-write failure.
   */
  stageTurnImages(chatId: string, images: UserTurnImage[]): Promise<StagedImage[]>;
  /** Read-back: map an absolute staged path → its metadata, or undefined. */
  lookupByPath(chatId: string, absPath: string): StagedImageMeta | undefined;
  /**
   * Read-back by staged id (the read-back route's addressing key): returns the
   * absolute on-disk file path + mediaType for `<chatId>/<id>`, or undefined.
   * Rejects ids/chatIds that are not safe single-segment tokens (traversal
   * guard) by returning undefined.
   */
  resolveById(chatId: string, id: string): { absPath: string; mediaType: string } | undefined;
}

export class StageImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageImageError";
  }
}

export interface CreateImageStoreOptions {
  /** Base data dir; defaults to `path.join(os.homedir(), ".loom")`. */
  dataDir?: string;
}

function extForMime(mediaType: string): string {
  // Mirrors `routes/upload-image.ts`: take the subtype, normalise jpeg→jpg.
  return mediaType.split("/")[1].replace("jpeg", "jpg");
}

export function createImageStore(opts: CreateImageStoreOptions = {}): ImageStore {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".loom");

  function chatDir(chatId: string): string {
    return path.join(dataDir, "images", chatId);
  }
  function manifestPath(chatId: string): string {
    return path.join(chatDir(chatId), "manifest.json");
  }

  function readManifest(chatId: string): ImageManifest {
    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath(chatId), "utf8");
    } catch {
      return { version: 1, entries: {} };
    }
    try {
      const parsed = JSON.parse(raw) as ImageManifest;
      return { version: 1, entries: parsed.entries ?? {} };
    } catch {
      console.warn(
        `[loom] image-store: corrupt manifest for chat ${chatId}; treating as empty`,
      );
      return { version: 1, entries: {} };
    }
  }

  function writeManifest(chatId: string, manifest: ImageManifest): void {
    const target = manifestPath(chatId);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, target);
  }

  return {
    async stageTurnImages(chatId, images) {
      const dir = chatDir(chatId);
      fs.mkdirSync(dir, { recursive: true });
      const manifest = readManifest(chatId);
      const staged: StagedImage[] = [];
      for (const image of images) {
        if (!ALLOWED_MIME.has(image.mediaType)) {
          throw new StageImageError(
            `unsupported image mediaType: ${image.mediaType}`,
          );
        }
        let bytes: Buffer;
        try {
          bytes = Buffer.from(image.dataB64, "base64");
          if (bytes.length === 0 && image.dataB64.length > 0) {
            throw new Error("decoded to zero bytes");
          }
          // Round-trip guard: base64 that does not re-encode to itself is malformed.
          if (bytes.toString("base64").replace(/=+$/, "") !==
              image.dataB64.replace(/=+$/, "")) {
            throw new Error("not valid base64");
          }
        } catch (err) {
          throw new StageImageError(
            `failed to decode base64 image: ${(err as Error).message}`,
          );
        }
        const id = crypto.randomBytes(16).toString("hex");
        const ext = extForMime(image.mediaType);
        const absPath = path.join(dir, `${id}.${ext}`);
        try {
          fs.writeFileSync(absPath, bytes);
        } catch (err) {
          throw new StageImageError(
            `failed to write image to disk: ${(err as Error).message}`,
          );
        }
        manifest.entries[absPath] = {
          mediaType: image.mediaType,
          filename: image.filename,
          stagedAt: new Date().toISOString(),
          id,
        };
        staged.push({
          absPath,
          mediaType: image.mediaType,
          filename: image.filename,
        });
      }
      writeManifest(chatId, manifest);
      return staged;
    },

    lookupByPath(chatId, absPath) {
      return readManifest(chatId).entries[absPath];
    },

    resolveById(chatId, id) {
      // Traversal guard: chatId and id must be single, separator-free
      // segments. The id is a 32-char hex token by construction.
      if (!/^[0-9a-f]{32}$/.test(id)) return undefined;
      if (chatId.includes("/") || chatId.includes("\\") || chatId.includes("..")) {
        return undefined;
      }
      const entries = readManifest(chatId).entries;
      for (const [absPath, meta] of Object.entries(entries)) {
        if (meta.id === id) return { absPath, mediaType: meta.mediaType };
      }
      return undefined;
    },
  };
}
