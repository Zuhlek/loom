/**
 * POST /upload-image — receives image bytes (multipart) and returns a
 * temporary URL+id the chat composer can reference.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const UPLOAD_DIR = path.join(os.tmpdir(), "nora-uploads");

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function mountUploadImageRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/upload-image"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    ensureDir();
    const ct = req.headers.get("content-type") ?? "";
    let buf: Uint8Array;
    let mime: string = "application/octet-stream";
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return new Response(JSON.stringify({ error: "missing file" }), { status: 400 });
      }
      mime = file.type || mime;
      buf = new Uint8Array(await file.arrayBuffer());
    } else {
      mime = ct;
      buf = new Uint8Array(await req.arrayBuffer());
    }
    if (!ALLOWED_MIME.has(mime)) {
      return new Response(JSON.stringify({ error: `unsupported mime ${mime}` }), { status: 415 });
    }
    const id = crypto.randomBytes(16).toString("hex");
    const ext = mime.split("/")[1].replace("jpeg", "jpg");
    const file = path.join(UPLOAD_DIR, `${id}.${ext}`);
    fs.writeFileSync(file, buf);
    return new Response(JSON.stringify({ id, path: file, mime, size: buf.byteLength }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
