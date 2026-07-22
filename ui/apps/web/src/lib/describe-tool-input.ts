/**
 * One-line human summary of a tool_use block's input, keyed by tool name.
 * Tolerant of a non-object `input` (returns ""). Shared by ToolUseCard
 * and WorkGroupCard.
 */
export function describeInput(name: string, input: unknown): string {
  const safe: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const get = (k: string): string | undefined => {
    const v = safe[k];
    return typeof v === "string" ? v : undefined;
  };
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return get("file_path") ?? "";
    case "Bash": {
      const cmd = get("command") ?? "";
      return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
    }
    case "Glob":
    case "Grep":
      return get("pattern") ?? "";
    case "WebFetch":
    case "WebSearch":
      return get("url") ?? get("query") ?? "";
    case "TodoWrite": {
      const todos = (safe as { todos?: unknown }).todos;
      return Array.isArray(todos) ? `${todos.length} task${todos.length === 1 ? "" : "s"}` : "";
    }
    case "Task":
    case "Agent":
      return get("description") ?? "";
    default: {
      for (const [k, v] of Object.entries(safe)) {
        if (typeof v === "string" && v.length > 0) {
          return `${k}=${v.length > 80 ? `${v.slice(0, 80)}…` : v}`;
        }
      }
      return "";
    }
  }
}
