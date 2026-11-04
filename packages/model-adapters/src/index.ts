import { callAnthropic } from "./anthropic";
import { callOpenAICompatible } from "./openai";
import type { CallModel, ModelEndpoint } from "./types";

export * from "./types";
export { validateEndpoint } from "./endpoint";

export const callModel: CallModel = (config, request) =>
  config.adapter === "anthropic_messages" ? callAnthropic(config, request) : callOpenAICompatible(config, request);

/** Fixed, non-sensitive request for the settings page's connection test (F01). */
export async function testConnection(config: ModelEndpoint): Promise<{ model: string }> {
  const r = await callModel(
    { ...config, outputLimit: Math.min(config.outputLimit, 2000) },
    {
      system: "Reply with the requested JSON only.",
      text: 'Connection test. Return {"ok": true}.',
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      schemaName: "connection_test",
    },
  );
  return { model: r.model };
}

export const ADAPTER_DEFAULTS: Record<ModelEndpoint["adapter"], { endpoint: string; model: string; contextLimit: number }> = {
  anthropic_messages: { endpoint: "https://api.anthropic.com", model: "claude-opus-5-5", contextLimit: 1_000_000 },
  openai_compatible: { endpoint: "https://api.openai.com/v1", model: "", contextLimit: 128_000 },
};
