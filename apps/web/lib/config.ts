import { resolve } from "node:path";

// Runtime locations, not build inputs: excluded from output file tracing.
// Defaults are relative to apps/web, where npm workspace scripts run.
const dataDir = resolve(/*turbopackIgnore: true*/ process.env.PEW_DATA_DIR ?? "../../.data");

export const config = {
  dataDir,
  databaseUrl: process.env.PEW_DATABASE_URL ?? `pglite:${resolve(/*turbopackIgnore: true*/ dataDir, "pglite")}`,
  migrationsDir: resolve(/*turbopackIgnore: true*/ process.env.PEW_MIGRATIONS_DIR ?? "../../migrations"),
  version: process.env.npm_package_version ?? "0.1.0",
};
