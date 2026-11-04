// OpenAI-compatible chat completions adapter (plain HTTP: the protocol is
// implemented by many servers, so no vendor SDK). Compatibility varies by
// server; the fallbacks below only react to a request being refused with 400,
// which is not billed.

import { noRedirectFetch, validateEndpoint } from "./endpoint";
import { ModelError, type ModelEndpoint, type ModelRequest, type ModelResponse } from "./types";

interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function statusError(status: number, detail: string): ModelError {
  if (status === 401) return new ModelError("auth", "密钥无效", status);
  if (status === 403) return new ModelError("auth", "该密钥没有使用此模型的权限", status);
  if (status === 404) return new ModelError("model_not_found", "模型不存在，或端点路径不对", status);
  if (status === 429) return new ModelError("rate_limited", "请求过于频繁，或已达到额度上限", status);
  if (status === 400 || status === 422) return new ModelError("unsupported_format", `模型服务拒绝了请求：${detail}`.slice(0, 300), status);
  return new ModelError("network", `模型服务返回错误 ${status}`, status);
}

export async function callOpenAICompatible(config: ModelEndpoint, request: ModelRequest): Promise<ModelResponse> {
  const url = validateEndpoint(config.endpoint, config.allowLocalHttp);
  const target = `${url.toString().replace(/\/$/, "")}/chat/completions`;
  const userContent = request.images?.length
    ? [
        ...request.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
        { type: "text", text: request.text },
      ]
    : request.text;
  const schemaFormat = { type: "json_schema", json_schema: { name: request.schemaName, schema: request.schema, strict: true } };

  const post = async (format: object, system: string, limitField: string) => {
    const timeout = AbortSignal.timeout(config.timeoutMs);
    let res: Response;
    try {
      res = await noRedirectFetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          [limitField]: config.outputLimit,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
          response_format: format,
        }),
        signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
      });
    } catch (err) {
      if (request.signal?.aborted) throw new ModelError("canceled", "已取消");
      if (timeout.aborted) throw new ModelError("outcome_unknown", "请求超时，模型服务可能已经执行并计费");
      throw new ModelError("network", err instanceof Error && /redirect/i.test(String(err.cause ?? err.message)) ? "端点发生了重定向，已拒绝" : "无法连接模型服务");
    }
    return res;
  };

  let system = request.system;
  let format: object = schemaFormat;
  let limitField = "max_tokens";
  let res = await post(format, system, limitField);
  for (let i = 0; i < 2 && res.status === 400; i++) {
    const detail = await res.clone().text();
    if (/max_completion_tokens/.test(detail) && limitField === "max_tokens") limitField = "max_completion_tokens";
    else if (/response_format|json_schema/.test(detail) && format === schemaFormat) {
      // Server without schema support: ask for JSON and let our validator check it.
      format = { type: "json_object" };
      system = `${request.system}\n\n只输出符合此 JSON Schema 的 JSON：\n${JSON.stringify(request.schema)}`;
    } else break;
    res = await post(format, system, limitField);
  }
  if (!res.ok) throw statusError(res.status, (await res.text()).slice(0, 200));

  let body: ChatResponse;
  try {
    body = (await res.json()) as ChatResponse;
  } catch {
    throw new ModelError("invalid_output", "模型服务返回的不是 JSON");
  }
  const choice = body.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new ModelError("refused", "模型拒绝处理这次请求");
  if (choice?.finish_reason === "length") throw new ModelError("truncated", "输出被截断，请在设置中调高输出上限");
  return {
    text: choice?.message?.content ?? "",
    model: body.model ?? config.model,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  };
}
