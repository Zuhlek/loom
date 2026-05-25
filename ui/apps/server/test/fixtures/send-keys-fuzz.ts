/**
 * T-018 — fuzz fixture for `tmux send-keys -l --` literal-mode behaviour.
 *
 * Each entry is a payload that the bridge MUST deliver byte-for-byte
 * verbatim to `tmux send-keys` argv. See `tmux-session.fuzz.test.ts` for
 * the assertion that the argv ends with `["-l", "--", input]`.
 */
export const SEND_KEYS_FUZZ_INPUTS: readonly { name: string; input: string }[] = [
  { name: "plain ascii", input: "hello world" },
  { name: "multiline", input: "line one\nline two\nline three" },
  { name: "trailing newline", input: "wrapped\n" },
  { name: "carriage return", input: "carriage\rreturn" },
  { name: "tab characters", input: "col1\tcol2\tcol3" },
  { name: "shell metachars", input: "$(echo pwned); rm -rf / & true | false" },
  { name: "leading dash", input: "--this-looks-like-a-flag" },
  { name: "backticks", input: "before `inside` after" },
  { name: "double + single quotes", input: `she said "it's fine"` },
  { name: "embedded ANSI escape", input: "\x1b[1mbold\x1b[22m" },
  { name: "ESC literal", input: "\x1b" },
  { name: "BEL", input: "\x07ring" },
  { name: "NUL byte", input: "before\x00after" },
  { name: "Unicode emoji", input: "deploy 🚀 now" },
  { name: "RTL Arabic", input: "السلام عليكم" },
  { name: "combining diacritics", input: "café́ (mixed)" },
  { name: "paste block w/ inner backticks", input: "```\ncode\nblock\n```" },
  { name: "very long", input: "x".repeat(4096) },
  { name: "tmux send-keys keynames as content", input: "Enter Escape C-c BSpace" },
  { name: "empty", input: "" },
] as const;
