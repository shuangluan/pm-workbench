// Node-only startup: open the database and apply migrations before serving.
// A failed migration stops startup instead of serving against a half-migrated
// schema (PRD §9.3).
//
// First run in an interactive terminal: print the one-time setup code right
// here, so a PM needs only one terminal. When output is not a terminal (Docker,
// redirected logs) the code is never printed; use `npm run access:reset`.

import { instanceStatus, issueSetupCode } from "@pew/db";
import { config } from "./lib/config";
import { getHandle } from "./lib/db";

try {
  const handle = await getHandle();
  const status = await instanceStatus(handle.db, config.dataDir);
  console.log(`[pew] database ready (${handle.kind})`);
  if (!status.initialized) {
    const port = process.env.PORT ?? "3210";
    if (process.stdout.isTTY) {
      const { code } = await issueSetupCode(config.dataDir);
      process.stdout.write(
        [
          "",
          "  ┌─────────────────────────────────────────────────────────────┐",
          "  │  首次使用 · First run                                        │",
          `  │  打开 http://127.0.0.1:${port}/login 并输入初始化码：`.padEnd(62) + "│",
          `  │      ${code}`.padEnd(62) + "│",
          "  │  30 分钟内有效，只显示在这个终端。                           │",
          "  └─────────────────────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    } else {
      console.log("[pew] not initialized: run `npm run access:reset` to get a one-time setup code.");
    }
  }
} catch (err) {
  console.error("[pew] startup failed:", err instanceof Error ? err.message : err);
  console.error("[pew] fix the error above or restore from backup; see docs/recovery.md");
  process.exit(1);
}
