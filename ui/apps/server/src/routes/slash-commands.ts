/**
 * GET /slash-commands?cwd=...
 */
import { scanSlashCommands } from "../slash-commands/scan.ts";

export function mountSlashCommandsRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/slash-commands"] = async (req, url) => {
    const cwd = url.searchParams.get("cwd") ?? undefined;
    const commands = scanSlashCommands(cwd);
    return new Response(JSON.stringify({ commands }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
