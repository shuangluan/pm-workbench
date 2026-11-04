// The single model configuration of an instance (F01). The API key can be
// replaced or removed but is never returned to the browser.

import { ADAPTER_DEFAULTS, testConnection, validateEndpoint, type AdapterName, type ModelEndpoint } from "@pew/model-adapters";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId } from "../errors";
import { analysisRuns, modelConfigs, usageRecords } from "../schema";
import { decryptSecret, encryptSecret } from "../secrets";

export interface ModelConfigInput {
  adapter: AdapterName;
  endpoint: string;
  model: string;
  apiKey?: string;
  allowLocalHttp: boolean;
  contextLimit: number;
  outputLimit: number;
  timeoutSeconds: number;
  inputPricePerMillion?: string;
  outputPricePerMillion?: string;
}

export interface ModelConfigView extends Omit<ModelConfigInput, "apiKey"> {
  id: string;
  apiKeyHint: string | null;
  hasKey: boolean;
}

function toView(row: typeof modelConfigs.$inferSelect): ModelConfigView {
  return {
    id: row.id,
    adapter: row.adapter,
    endpoint: row.endpoint,
    model: row.model,
    allowLocalHttp: row.allowLocalHttp,
    contextLimit: row.contextLimit,
    outputLimit: row.outputLimit,
    timeoutSeconds: row.timeoutSeconds,
    inputPricePerMillion: row.inputPricePerMillion ?? undefined,
    outputPricePerMillion: row.outputPricePerMillion ?? undefined,
    apiKeyHint: row.apiKeyHint,
    hasKey: !!row.apiKeyCiphertext,
  };
}

export async function getModelConfig(db: Db): Promise<ModelConfigView | null> {
  const [row] = await db.select().from(modelConfigs).where(eq(modelConfigs.isActive, true));
  return row ? toView(row) : null;
}

const price = (v?: string) => {
  const t = v?.trim();
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) throw new AppError("invalid_input", "单价必须是数字");
  return t;
};

export async function saveModelConfig(db: Db, dataDir: string, input: ModelConfigInput) {
  if (!ADAPTER_DEFAULTS[input.adapter]) throw new AppError("invalid_input", "未知的适配器");
  if (!input.model.trim()) throw new AppError("invalid_input", "请填写模型 ID");
  try {
    validateEndpoint(input.endpoint, input.allowLocalHttp);
  } catch (err) {
    throw new AppError("invalid_input", err instanceof Error ? err.message : "端点无效");
  }
  for (const [label, n, min] of [["上下文上限", input.contextLimit, 1000], ["输出上限", input.outputLimit, 256], ["超时", input.timeoutSeconds, 5]] as const) {
    if (!Number.isInteger(n) || n < min) throw new AppError("invalid_input", `${label}需要是不小于 ${min} 的整数`);
  }
  const key = input.apiKey?.trim();
  const values = {
    adapter: input.adapter,
    endpoint: input.endpoint.trim(),
    model: input.model.trim(),
    allowLocalHttp: input.allowLocalHttp,
    contextLimit: input.contextLimit,
    outputLimit: input.outputLimit,
    timeoutSeconds: input.timeoutSeconds,
    inputPricePerMillion: price(input.inputPricePerMillion),
    outputPricePerMillion: price(input.outputPricePerMillion),
    updatedAt: new Date(),
    ...(key ? { apiKeyCiphertext: encryptSecret(dataDir, key), apiKeyHint: `…${key.slice(-4)}` } : {}),
  };
  const [existing] = await db.select({ id: modelConfigs.id }).from(modelConfigs).where(eq(modelConfigs.isActive, true));
  if (existing) await db.update(modelConfigs).set(values).where(eq(modelConfigs.id, existing.id));
  else await db.insert(modelConfigs).values({ id: newId("mc"), isActive: true, ...values });
}

export async function removeModelKey(db: Db) {
  await db.update(modelConfigs).set({ apiKeyCiphertext: null, apiKeyHint: null, updatedAt: new Date() }).where(eq(modelConfigs.isActive, true));
}

/** Decrypted endpoint for an actual call. Stays on the server. */
export async function resolveModelEndpoint(db: Db, dataDir: string): Promise<ModelEndpoint & { pricing: { inputPerMillion?: number; outputPerMillion?: number } }> {
  const [row] = await db.select().from(modelConfigs).where(eq(modelConfigs.isActive, true));
  if (!row?.apiKeyCiphertext) throw new AppError("not_initialized", "尚未配置模型密钥");
  return {
    adapter: row.adapter,
    endpoint: row.endpoint,
    model: row.model,
    apiKey: decryptSecret(dataDir, row.apiKeyCiphertext),
    outputLimit: row.outputLimit,
    timeoutMs: row.timeoutSeconds * 1000,
    allowLocalHttp: row.allowLocalHttp,
    pricing: {
      inputPerMillion: row.inputPricePerMillion ? Number(row.inputPricePerMillion) : undefined,
      outputPerMillion: row.outputPricePerMillion ? Number(row.outputPricePerMillion) : undefined,
    },
  };
}

export async function testModelConnection(db: Db, dataDir: string) {
  return testConnection(await resolveModelEndpoint(db, dataDir));
}

/** Recent model calls for the diagnostics page. Unknown token counts stay null. */
export async function listUsage(db: Db, limit = 20) {
  return db
    .select({
      id: usageRecords.id,
      provider: usageRecords.provider,
      model: usageRecords.model,
      attempt: usageRecords.attempt,
      durationMs: usageRecords.durationMs,
      inputTokens: usageRecords.inputTokens,
      outputTokens: usageRecords.outputTokens,
      estimatedCost: usageRecords.estimatedCost,
      createdAt: usageRecords.createdAt,
      taskType: analysisRuns.taskType,
    })
    .from(usageRecords)
    .leftJoin(analysisRuns, eq(analysisRuns.id, usageRecords.runId))
    .orderBy(desc(usageRecords.createdAt))
    .limit(limit);
}
