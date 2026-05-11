#!/usr/bin/env node
/*
 * pty-helper.cjs — sidecar node process that wraps node-pty.
 *
 * The main nora-server runs under Bun, which currently has a buggy
 * interaction with node-pty's libuv async hooks (events never fire). We
 * spawn this helper as a child node process and bridge it via JSON
 * line-delimited frames over stdin/stdout.
 *
 * Frames (one JSON per line, terminated by \n):
 *   stdin (bun → helper):
 *     {"kind":"start","shell":"claude","args":[],"cwd":"/path","cols":80,"rows":24}
 *     {"kind":"write","data":"<text>"}
 *     {"kind":"resize","cols":120,"rows":40}
 *     {"kind":"kill","signal":"SIGTERM"}
 *   stdout (helper → bun):
 *     {"kind":"started","pid":1234}
 *     {"kind":"data","data":"<text>"}
 *     {"kind":"exit","exitCode":0,"signal":null}
 *     {"kind":"error","message":"..."}
 */

const readline = require("readline");

let pty = null;
let term = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    send({ kind: "error", message: "bad json from parent" });
    return;
  }
  try {
    if (msg.kind === "start") {
      if (!pty) pty = require("node-pty");
      term = pty.spawn(msg.shell, msg.args || [], {
        cwd: msg.cwd,
        cols: msg.cols || 80,
        rows: msg.rows || 24,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      send({ kind: "started", pid: term.pid });
      term.on("data", (data) => send({ kind: "data", data }));
      term.on("exit", (code, signal) => {
        send({ kind: "exit", exitCode: code ?? -1, signal: signal ?? null });
        process.exit(0);
      });
    } else if (msg.kind === "write") {
      if (term) term.write(msg.data);
    } else if (msg.kind === "resize") {
      if (term) term.resize(msg.cols || 80, msg.rows || 24);
    } else if (msg.kind === "kill") {
      if (term) term.kill(msg.signal || "SIGTERM");
    }
  } catch (err) {
    send({ kind: "error", message: err && err.message ? err.message : String(err) });
  }
});

process.on("disconnect", () => {
  try {
    if (term) term.kill("SIGTERM");
  } catch {}
  process.exit(0);
});

process.on("SIGTERM", () => {
  try {
    if (term) term.kill("SIGTERM");
  } catch {}
  process.exit(0);
});
