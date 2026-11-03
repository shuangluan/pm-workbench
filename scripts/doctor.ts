// Local health check (PRD §9.2). Prints no source text, prompts or keys.

import { accessSync, constants, existsSync, readdirSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, pgliteLockHolder, redactUrl } from "@pew/db";

const dataDir = resolve(process.env.PEW_DATA_DIR ?? ".data");
const url = process.env.PEW_DATABASE_URL ?? `pglite:${resolve(dataDir, "pglite")}`;
const migrations = resolve(process.env.PEW_MIGRATIONS_DIR ?? "migrations");
let failed = false;

const line = (ok: boolean | null, label: string, detail: string) => {
  if (ok === false) failed = true;
  console.log(`${ok === null ? "  -" : ok ? " ok" : "ERR"}  ${label.padEnd(16)} ${detail}`);
};

const [major] = process.versions.node.split(".").map(Number);
line(major! >= 22, "node", process.versions.node + (major! >= 22 ? "" : " (need >= 22)"));

try {
  if (existsSync(dataDir)) accessSync(dataDir, constants.W_OK);
  const s = existsSync(dataDir) ? statfsSync(dataDir) : statfsSync(".");
  const gb = (s.bavail * s.bsize) / 1024 ** 3;
  line(gb >= 1, "data dir", `${dataDir} (${gb.toFixed(1)} GB free${existsSync(dataDir) ? "" : ", not created yet"})`);
} catch {
  line(false, "data dir", `${dataDir} is not writable`);
}

const files = existsSync(migrations) ? readdirSync(migrations).filter((f) => f.endsWith(".sql")) : [];
line(files.length > 0, "migrations", `${files.length} file(s) in ${migrations}`);

if (url.startsWith("pglite:") && pgliteLockHolder(resolve(url.slice(7))) !== null) {
  line(null, "database", `in use by the running server (pid ${pgliteLockHolder(resolve(url.slice(7)))}); skipped`);
} else {
  try {
    const handle = await openDb(url);
    await handle.migrate(migrations);
    line(true, "database", `${handle.kind} ${handle.location}, migrations applied`);
    await handle.close();
  } catch (err) {
    line(false, "database", `${redactUrl(url)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

line(null, "model", "not configured in this version (M2)");
process.exit(failed ? 1 : 0);
