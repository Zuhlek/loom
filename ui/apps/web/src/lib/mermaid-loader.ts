/**
 * Single owner of the lazy `import("mermaid")` promise and the
 * one-shot {@link mermaid.initialize} call. Concurrent first-time
 * callers await the same promise so the chunk loads exactly once and
 * `initialize` runs exactly once for the page lifetime.
 */
type MermaidApi = {
  initialize(config: {
    startOnLoad: boolean;
    securityLevel: "strict" | "loose" | "antiscript" | "sandbox";
    theme: "default" | "dark" | "neutral" | "forest" | "base";
  }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let promise: Promise<MermaidApi> | null = null;

export function loadMermaid(): Promise<MermaidApi> {
  if (!promise) {
    promise = import("mermaid").then((module) => {
      const api = (module as { default: MermaidApi }).default;
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
      });
      return api;
    });
  }
  return promise;
}

export function __resetForTests(): void {
  promise = null;
}
