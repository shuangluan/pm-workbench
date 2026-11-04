// Runs before the server starts, from the npm script. The setup code has to be
// printed here: `next dev` pipes its server's output through itself in a real
// terminal, so the server cannot tell whether a person is watching.
// Only an interactive terminal gets a code; redirected output and Docker logs
// never do (PRD F01). This must not block startup: any problem is left for the
// server to report.

import { resolve } from "node:path";
import { instanceStatus, issueSetupCode, openDb, pgliteLockHolder } from "@pew/db";

if (process.stdout.isTTY) {
  // Same defaults as apps/web/lib/config.ts: npm runs this from apps/web.
  const dataDir = resolve(process.env.PEW_DATA_DIR ?? "../../.data");
  const url = process.env.PEW_DATABASE_URL ?? `pglite:${resolve(dataDir, "pglite")}`;
  try {
    if (!url.startsWith("pglite:") || pgliteLockHolder(resolve(url.slice("pglite:".length))) === null) {
      const handle = await openDb(url);
      await handle.migrate(resolve(process.env.PEW_MIGRATIONS_DIR ?? "../../migrations"));
      const { initialized } = await instanceStatus(handle.db, dataDir);
      await handle.close();
      if (!initialized) {
        const { code } = await issueSetupCode(dataDir);
        const port = process.env.PORT ?? "3210";
        process.stdout.write(
          ["", "  首次使用 · First run", "", `  1. 打开 Open  http://127.0.0.1:${port}/login`, `  2. 输入初始化码 Enter this setup code:  ${code}`, "", "  30 分钟内有效，只显示这一次。Valid for 30 minutes, shown only here.", "", ""].join("\n"),
        );
      }
    }
  } catch {
    // The server reports database problems on startup.
  }
}
