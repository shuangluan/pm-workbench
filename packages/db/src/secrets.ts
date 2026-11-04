// Model API keys at rest (PRD §8.2): AES-256-GCM under an instance master key.
// The key comes from PEW_MASTER_KEY, or from a random file created in the data
// directory with owner-only permissions. There is no built-in default, and
// neither the key nor the ciphertext is ever part of a product export.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "./errors";

function masterKey(dataDir: string): Buffer {
  const fromEnv = process.env.PEW_MASTER_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new AppError("invalid_input", "PEW_MASTER_KEY 必须是 32 字节的 base64");
    return key;
  }
  const path = join(dataDir, "master.key");
  try {
    return Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  } catch {
    const key = randomBytes(32);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, key.toString("base64"), { mode: 0o600, flag: "wx" });
    return key;
  }
}

export function encryptSecret(dataDir: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(dataDir), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(dataDir: string, stored: string): string {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new AppError("invalid_input", "密钥记录格式无法识别，请重新填写模型密钥");
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(dataDir), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("invalid_input", "无法解密模型密钥（主密钥不一致，常见于恢复备份后）。请在设置中重新填写。");
  }
}
