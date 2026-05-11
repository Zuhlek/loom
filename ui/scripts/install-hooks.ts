/**
 * Standalone hook-installer entrypoint. Run with `bun run install-hooks`.
 *
 * Wraps apps/server/src/hook-installer.ts so the user can opt in without
 * the dev script auto-installing.
 */
import { install, detectConflict, resolveSettingsPath } from "../apps/server/src/hook-installer.ts";

const port = parseInt(process.env.NORA_PORT ?? "3737", 10);
const settingsPath = resolveSettingsPath();
const conflict = detectConflict();
console.log(`[install-hooks] settings path: ${settingsPath}`);
console.log(`[install-hooks] pre-existing nora marker: ${conflict.hasMarker}`);
console.log(`[install-hooks] pre-existing user hooks: ${conflict.hasUserHooks}`);

const result = install({ receiverPort: port });
console.log(`[install-hooks] wroteFreshFile=${result.wroteFreshFile} appendedBelowExisting=${result.appendedBelowExisting}`);
console.log("[install-hooks] done.");
