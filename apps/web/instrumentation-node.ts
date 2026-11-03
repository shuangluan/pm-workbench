// Node-only startup: open the database and apply migrations before serving.
// A failed migration stops startup instead of serving against a half-migrated
// schema (PRD §9.3).

import { instanceStatus } from "@pew/db";
import { config } from "./lib/config";
import { getHandle } from "./lib/db";

try {
  const handle = await getHandle();
  const status = await instanceStatus(handle.db, config.dataDir);
  console.log(`[pew] database ready (${handle.kind})`);
  if (!status.initialized && !status.setupPending) {
    console.log("[pew] not initialized yet: run `npm run access:reset` in another terminal to get a one-time setup code.");
  }
} catch (err) {
  console.error("[pew] startup failed:", err instanceof Error ? err.message : err);
  console.error("[pew] fix the error above or restore from backup; see docs/recovery.md");
  process.exit(1);
}
