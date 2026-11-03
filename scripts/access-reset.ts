// Issue a one-time setup code (first initialization or access reset, PRD F01).
// Writes only a hash to the data directory and never touches the database, so
// it works while the server is running. Every existing session stops working.

import { resolve } from "node:path";
import { issueSetupCode, SETUP_CODE_TTL_MS } from "@pew/db";

const dataDir = resolve(process.env.PEW_DATA_DIR ?? ".data");
const { code, expiresAt } = await issueSetupCode(dataDir);

process.stdout.write(
  [
    "",
    "  One-time setup code / 一次性初始化码：",
    "",
    `      ${code}`,
    "",
    `  Valid for ${SETUP_CODE_TTL_MS / 60_000} minutes (until ${expiresAt.toLocaleTimeString()}).`,
    "  Open http://127.0.0.1:3210/login, enter the code and choose a passphrase.",
    "  All existing sessions are signed out now. This code is not logged anywhere.",
    "",
  ].join("\n"),
);
