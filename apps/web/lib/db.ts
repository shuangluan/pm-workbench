import { openDb, type Db, type DbHandle } from "@pew/db";
import { config } from "./config";

// One handle per server process, shared across route modules and dev reloads.
const holder = globalThis as typeof globalThis & { __pewDb?: Promise<DbHandle> };

export function getHandle(): Promise<DbHandle> {
  holder.__pewDb ??= (async () => {
    const handle = await openDb(config.databaseUrl);
    await handle.migrate(config.migrationsDir);
    return handle;
  })();
  return holder.__pewDb;
}

export async function getDb(): Promise<Db> {
  return (await getHandle()).db;
}
