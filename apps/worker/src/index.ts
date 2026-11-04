// Standalone worker for the Postgres (Compose) setup. PGlite instances run the
// same loop inside the web process and do not use this entry point.

import { resolve } from "node:path";
import { openDb, startWorker } from "@pew/db";

const url = process.env.PEW_DATABASE_URL;
if (!url?.startsWith("postgres")) {
  console.error("[pew-worker] PEW_DATABASE_URL must be a Postgres URL. PGlite runs its worker inside the web process.");
  process.exit(1);
}

const handle = await openDb(url);
const worker = startWorker({ db: handle.db, dataDir: resolve(process.env.PEW_DATA_DIR ?? "/data") });
console.log("[pew-worker] started");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    worker.stop();
    void handle.close().finally(() => process.exit(0));
  });
}
