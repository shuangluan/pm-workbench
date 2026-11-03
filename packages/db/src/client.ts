// Database connection. `postgres://…` uses a real Postgres server (the Compose
// setup); `pglite:<dir>` runs an embedded Postgres in-process for machines
// without Docker. PGlite allows one process per data directory, so we hold a
// lock file and refuse a second opener instead of risking corruption.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  /** Human-readable location without credentials. */
  location: string;
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
}

export class DbLockedError extends Error {
  constructor(readonly lockFile: string, readonly pid: number) {
    super(`database directory is in use by process ${pid}; stop the server first (${lockFile})`);
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Returns the pid holding the lock, or null when free or stale. */
export function pgliteLockHolder(dir: string): number | null {
  try {
    const pid = Number(readFileSync(`${dir}.lock`, "utf8").trim());
    return Number.isInteger(pid) && pid !== process.pid && pidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function acquireLock(dir: string): () => void {
  const lockFile = `${dir}.lock`;
  const holder = pgliteLockHolder(dir);
  if (holder !== null) throw new DbLockedError(lockFile, holder);
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, String(process.pid), { mode: 0o600 });
  const release = () => {
    try {
      if (readFileSync(lockFile, "utf8").trim() === String(process.pid)) rmSync(lockFile);
    } catch {
      // already gone
    }
  };
  process.once("exit", release);
  return release;
}

export function redactUrl(url: string): string {
  return url.replace(/\/\/([^:/@]+)(:[^@]*)?@/, "//$1:***@");
}

export async function openDb(url: string): Promise<DbHandle> {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query("select 1");
    const db = drizzlePg(pool, { schema });
    return {
      db: db as unknown as Db,
      kind: "postgres",
      location: redactUrl(url),
      migrate: (migrationsFolder) => migratePg(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite:".length);
    if (target === "memory") {
      const client = new PGlite();
      const db = drizzlePglite(client, { schema });
      return {
        db: db as unknown as Db,
        kind: "pglite",
        location: "memory",
        migrate: (migrationsFolder) => migratePglite(db, { migrationsFolder }),
        close: () => client.close(),
      };
    }
    const dir = resolve(target);
    const release = acquireLock(dir);
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    await client.waitReady;
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Db,
      kind: "pglite",
      location: dir,
      migrate: (migrationsFolder) => migratePglite(db, { migrationsFolder }),
      close: async () => {
        await client.close();
        release();
      },
    };
  }
  throw new Error("PEW_DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}
