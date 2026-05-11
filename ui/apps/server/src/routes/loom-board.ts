/**
 * GET /loom/board?cwd=...&project=...  → parsed board.md kanban
 * GET /loom/events?cwd=...&project=...  → tail of events.jsonl
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseBoard } from "../loom/parse-board.ts";

export function mountLoomBoardRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/loom/board"] = async (req, url) => {
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

  routes["/loom/events"] = async (req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const project = url.searchParams.get("project") ?? "";
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    if (!cwd || !project) return new Response(JSON.stringify({ error: "missing args" }), { status: 400 });
    const file = path.join(cwd, ".loom", project, "events.jsonl");
    if (!fs.existsSync(file)) {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-limit);
    const events = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
