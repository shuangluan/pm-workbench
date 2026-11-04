// Anthropic Messages adapter, via the official SDK. Retries are off here so the
// run policy (at most one automatic retry, every attempt recorded) stays in
// one place. Server-side model fallbacks are deliberately not enabled: a run
// must not silently switch models (PRD §7.2).

import Anthropic from "@anthropic-ai/sdk";
import { noRedirectFetch, validateEndpoint } from "./endpoint";
import { ModelError, type ModelEndpoint, type ModelRequest, type ModelResponse } from "./types";

function mapError(err: unknown): ModelError {
  if (err instanceof Anthropic.APIUserAbortError) return new ModelError("canceled", "已取消");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ModelError("outcome_unknown", "请求超时，模型服务可能已经执行并计费");
  if (err instanceof Anthropic.APIConnectionError) return new ModelError("network", "无法连接模型服务");
  if (err instanceof Anthropic.AuthenticationError) return new ModelError("auth", "密钥无效", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new ModelError("auth", "该密钥没有使用此模型的权限", 403);
  if (err instanceof Anthropic.NotFoundError) return new ModelError("model_not_found", "模型不存在，或该账号无法使用", 404);
  if (err instanceof Anthropic.RateLimitError) return new ModelError("rate_limited", "请求过于频繁，或已达到额度上限", 429);
  if (err instanceof Anthropic.BadRequestError) return new ModelError("unsupported_format", `模型服务拒绝了请求：${err.message}`.slice(0, 300), 400);
  if (err instanceof Anthropic.InternalServerError) return new ModelError("network", "模型服务暂时不可用", err.status);
  if (err instanceof Anthropic.APIError) return new ModelError("network", `模型服务返回错误 ${err.status ?? ""}`.trim(), err.status);
  throw err;
}

export async function callAnthropic(config: ModelEndpoint, request: ModelRequest): Promise<ModelResponse> {
  const url = validateEndpoint(config.endpoint, config.allowLocalHttp);
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: url.toString().replace(/\/$/, ""),
    maxRetries: 0,
    timeout: config.timeoutMs,
    fetch: noRedirectFetch,
  });
  const content: Anthropic.ContentBlockParam[] = [
    ...(request.images ?? []).map(
      (img): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType as Anthropic.Base64ImageSource["media_type"], data: img.base64 },
      }),
    ),
    { type: "text", text: request.text },
  ];
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: config.model,
        max_tokens: config.outputLimit,
        system: request.system,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: request.schema } },
      },
      { signal: request.signal },
    );
  } catch (err) {
    throw mapError(err);
  }
  if (response.stop_reason === "refusal") throw new ModelError("refused", "模型拒绝处理这次请求");
  if (response.stop_reason === "max_tokens") throw new ModelError("truncated", "输出被截断，请在设置中调高输出上限");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}
