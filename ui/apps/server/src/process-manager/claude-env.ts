/**
 * Build the env passed to a spawned `claude` PTY.
 *
 * Loom typically runs inside an IDE-launched shell (e.g. a VS Code
 * terminal during `pnpm dev`). The host IDE injects integration env
 * vars that, if forwarded to our spawned claude, make the child try to
 * attach to the host IDE's claude extension as a managed session —
 * which clashes with the host's own claude and breaks the OAuth /
 * keychain handshake (the child shows up as not-logged-in even though
 * the credentials are in the user's keychain).
 *
 * Mirrors t3code's `TERMINAL_ENV_BLOCKLIST` pattern
 * (apps/server/src/terminal/Layers/Manager.ts:55,665-681 in the t3code
 * reference under docs/t3code-main) but with loom's specific leakage
 * keys — t3code is its own Electron host so it strips Electron vars;
 * loom is launched from a host IDE so it strips IDE-host vars.
 */
const STRIP_KEYS = new Set([
  // VS Code Claude Code extension IDE-integration channel. If forwarded,
  // the spawned claude tries to attach to the host's extension server
  // and the auth state coming from keychain gets short-circuited by an
  // expected-but-absent host handshake.
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_AUTO_CONNECT_IDE",
  "CLAUDE_CODE_IDE_HOST_OVERRIDE",
  // VS Code's git askpass helper — points at a Code Helper binary that
  // pops UI inside VS Code, not in our chat surface.
  "VSCODE_GIT_ASKPASS_MAIN",
  "VSCODE_GIT_ASKPASS_NODE",
  "VSCODE_GIT_ASKPASS_EXTRA_ARGS",
  "VSCODE_GIT_IPC_HANDLE",
  "GIT_ASKPASS",
  // Falsely identifies the parent as VS Code; some tools key behavior
  // off this (telemetry, integration probes).
  "__CFBundleIdentifier",
  // Tells claude it's running inside a VS Code-hosted terminal, which
  // toggles IDE-aware code paths.
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  // Electron host leakage (matches t3code's blocklist) — harmless in
  // practice today but cheap to filter.
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_PORT",
  // Loom-internal config that has no business reaching claude.
  "LOOM_PORT",
  "LOOM_CLAUDE_BIN",
]);

export function buildClaudeSpawnEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (STRIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
