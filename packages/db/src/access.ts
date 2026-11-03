// Local single-operator access (PRD F01, §8.2).
//
// The CLI writes a one-time setup code (hashed) to a file in the data
// directory. It never touches the database, so it works while the server holds
// the PGlite lock. The browser exchanges the code for a passphrase; that
// consumes the code and revokes every existing session. Issuing a new code
// also invalidates all sessions created before it, immediately.

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { AppError, newId } from "./errors";
import { instanceState, localSessions } from "./schema";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SETUP_FILE = "setup-code.json";
export const SETUP_CODE_TTL_MS = 30 * 60_000;
export const SESSION_TTL_MS = 14 * 24 * 60 * 60_000;
export const MIN_PASSPHRASE_LENGTH = 10;
export const SESSION_COOKIE = "pew_session";

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(secret, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface SetupFile {
  codeId: string;
  hash: string;
  issuedAt: string;
  expiresAt: string;
}

// Crockford-style alphabet without look-alikes (0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** CLI side. Returns the code to show once on the terminal; only its hash is stored. */
export async function issueSetupCode(dataDir: string, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const raw = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const code = raw.match(/.{4}/g)!.join("-");
  const expiresAt = new Date(now.getTime() + SETUP_CODE_TTL_MS);
  const file: SetupFile = { codeId: newId("setup"), hash: await hashSecret(raw), issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, SETUP_FILE), JSON.stringify(file), { mode: 0o600 });
  return { code, expiresAt };
}

function readSetupFile(dataDir: string): SetupFile | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, SETUP_FILE), "utf8")) as SetupFile;
  } catch {
    return null;
  }
}

export interface InstanceStatus {
  initialized: boolean;
  /** A setup code exists and has not expired: the browser should show the setup form. */
  setupPending: boolean;
}

export async function instanceStatus(db: Db, dataDir: string, now = new Date()): Promise<InstanceStatus> {
  const [row] = await db.select({ s: instanceState.singleton }).from(instanceState);
  const file = readSetupFile(dataDir);
  return { initialized: !!row, setupPending: !!file && new Date(file.expiresAt) > now };
}

async function createSession(db: Db, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(localSessions).values({
    id: newId("sess"),
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
  });
  return token;
}

/**
 * Exchange a setup code for a new passphrase. Works for first initialization
 * and for CLI resets. A code is accepted once, even under concurrent requests.
 */
export async function completeSetup(db: Db, dataDir: string, code: string, passphrase: string, now = new Date()): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("invalid_input", `访问口令至少 ${MIN_PASSPHRASE_LENGTH} 个字符`);
  }
  const file = readSetupFile(dataDir);
  // Dashes and spacing are display-only.
  const normalized = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!file || new Date(file.expiresAt) <= now || !(await verifySecret(normalized, file.hash))) {
    throw new AppError("unauthorized", "初始化码无效或已过期。请在终端重新运行 npm run access:reset。");
  }
  const credential = await hashSecret(passphrase);

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(instanceState)
      .values({ accessCredentialHash: credential, lastSetupCodeId: file.codeId, credentialUpdatedAt: now })
      .onConflictDoNothing()
      .returning({ s: instanceState.singleton });
    if (!inserted.length) {
      const [row] = await tx.select().from(instanceState).for("update");
      if (row?.lastSetupCodeId === file.codeId) throw new AppError("unauthorized", "该初始化码已被使用。");
      await tx
        .update(instanceState)
        .set({ accessCredentialHash: credential, lastSetupCodeId: file.codeId, credentialUpdatedAt: now });
    }
    await tx.update(localSessions).set({ revokedAt: now }).where(isNull(localSessions.revokedAt));
  });
  rmSync(join(dataDir, SETUP_FILE), { force: true });
  return createSession(db, now);
}

export async function login(db: Db, passphrase: string, now = new Date()): Promise<string> {
  const [row] = await db.select().from(instanceState);
  if (!row) throw new AppError("not_initialized", "实例尚未初始化");
  if (!(await verifySecret(passphrase, row.accessCredentialHash))) {
    throw new AppError("unauthorized", "访问口令不正确");
  }
  return createSession(db, now);
}

export async function validateSession(db: Db, dataDir: string, token: string | undefined, now = new Date()): Promise<boolean> {
  if (!token) return false;
  const [session] = await db
    .select()
    .from(localSessions)
    .where(and(eq(localSessions.tokenHash, sha256(token)), isNull(localSessions.revokedAt), gt(localSessions.expiresAt, now)));
  if (!session) return false;
  // A reset issued after this session was created invalidates it right away.
  const pending = readSetupFile(dataDir);
  return !(pending && new Date(pending.issuedAt) > session.createdAt);
}

export async function logout(db: Db, token: string | undefined, now = new Date()): Promise<void> {
  if (!token) return;
  await db.update(localSessions).set({ revokedAt: now }).where(eq(localSessions.tokenHash, sha256(token)));
}
