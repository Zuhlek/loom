/**
 * GET /fabric/board?cwd=...&project=...  → parsed board.md kanban
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseBoard } from "../loom/parse-board.ts";
import { jsonResponse } from "./_response.ts";

export function mountFabricBoardRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/fabric/board"] = async (_req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const project = url.searchParams.get("project") ?? "";
    if (!cwd || !project) return jsonResponse({ error: "missing args" }, 400);
    const file = path.join(cwd, ".loom", project, "board.md");
    if (!fs.existsSync(file)) {
      return jsonResponse(
        { board: { columns: { Backlog: [], "In Progress": [], Review: [], Done: [] } } },
        200,
      );
    }
    const md = fs.readFileSync(file, "utf8");
    const board = parseBoard(md);
    return jsonResponse({ board }, 200);
  };
}
