/**
 * GET /fabric/board?cwd=...&project=...  → parsed board.md kanban
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseBoard } from "../loom/parse-board.ts";

export function mountFabricBoardRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/fabric/board"] = async (_req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const project = url.searchParams.get("project") ?? "";
    if (!cwd || !project) return new Response(JSON.stringify({ error: "missing args" }), { status: 400 });
    const file = path.join(cwd, ".loom", project, "board.md");
    if (!fs.existsSync(file)) {
      return new Response(JSON.stringify({ board: { columns: { Backlog: [], "In Progress": [], Review: [], Done: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const md = fs.readFileSync(file, "utf8");
    const board = parseBoard(md);
    return new Response(JSON.stringify({ board }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
