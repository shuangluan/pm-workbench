// Node-only startup: open the database and apply migrations before serving.
// A failed migration stops startup instead of serving against a half-migrated
// schema (PRD §9.3).
//
// The setup code itself is printed by scripts/first-run.ts, before this process
// starts. It is never logged from here.

import { instanceStatus, startWorker } from "@pew/db";
import { accessResetCommand, config } from "./lib/config";
import { getHandle } from "./lib/db";

try {
  const handle = await getHandle();
  const status = await instanceStatus(handle.db, config.dataDir);
  console.log(`[pew] database ready (${handle.kind})`);
  // PGlite is single-process, so the worker must live here. With Postgres it
  // can run separately (apps/worker); PEW_WORKER=external turns this one off.
  const holder = globalThis as typeof globalThis & { __pewWorker?: unknown };
  if (handle.kind === "pglite" || process.env.PEW_WORKER !== "external") {
    holder.__pewWorker ??= startWorker({ db: handle.db, dataDir: config.dataDir, exclusive: handle.kind === "pglite" });
  }
  if (!status.initialized && !status.setupPending) {
    console.log(`[pew] not initialized: run \`${accessResetCommand()}\` to get a one-time setup code.`);
  }
} catch (err) {
  console.error("[pew] startup failed:", err instanceof Error ? err.message : err);
  console.error("[pew] fix the error above or restore from backup; see docs/recovery.md");
  process.exit(1);
}
