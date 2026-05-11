/**
 * Reset loom's metadata store. Removes ~/.loom/metadata.db after asking
 * the user to confirm. Useful for clearing test/smoke chats from the
 * sidebar without touching config.json or running PTYs.
 *
 * Run with `pnpm reset-state`. Stop the dev server first — this
 * script does NOT kill running PTYs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

const dbPath = path.join(os.homedir(), ".loom", "metadata.db");

if (!fs.existsSync(dbPath)) {
  console.log(`[reset-state] nothing to do — ${dbPath} does not exist.`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`Delete ${dbPath}? [y/N] `, (answer) => {
  rl.close();
  const yes = answer.trim().toLowerCase().startsWith("y");
  if (!yes) {
    console.log("[reset-state] aborted.");
    process.exit(0);
  }
  try {
    fs.unlinkSync(dbPath);
    console.log(`[reset-state] removed ${dbPath}.`);
    console.log("[reset-state] note: running PTYs were NOT killed; stop the server first if needed.");
  } catch (err) {
    console.error(`[reset-state] failed: ${(err as Error).message}`);
    process.exit(1);
  }
});
