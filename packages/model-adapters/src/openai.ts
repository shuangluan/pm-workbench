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
  if (status === 401) return new ModelError("auth", "The key was rejected", status);
  if (status === 403) return new ModelError("auth", "This key is not allowed to use this model", status);
  if (status === 404) return new ModelError("model_not_found", "The model does not exist, or the endpoint path is wrong", status);
  if (status === 429) return new ModelError("rate_limited", "Too many requests, or the quota is used up", status);
  if (status === 400 || status === 422) return new ModelError("unsupported_format", `The model service rejected the request: ${detail}`.slice(0, 300), status);
  return new ModelError("network", `The model service returned error ${status}`, status);
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
      if (request.signal?.aborted) throw new ModelError("canceled", "Canceled");
      if (timeout.aborted) throw new ModelError("outcome_unknown", "The request timed out; the provider may already have run and billed it");
      throw new ModelError("network", err instanceof Error && /redirect/i.test(String(err.cause ?? err.message)) ? "The endpoint redirected, which is refused" : "Cannot reach the model service");
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
      system = `${request.system}\n\nRespond only with JSON matching this JSON Schema:\n${JSON.stringify(request.schema)}`;
    } else break;
    res = await post(format, system, limitField);
  }
  if (!res.ok) throw statusError(res.status, (await res.text()).slice(0, 200));

  let body: ChatResponse;
  try {
    body = (await res.json()) as ChatResponse;
  } catch {
    throw new ModelError("invalid_output", "The model service did not return JSON");
  }
  const choice = body.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new ModelError("refused", "The model refused this request");
  if (choice?.finish_reason === "length") throw new ModelError("truncated", "The output was cut off; raise the output limit under Settings");
  return {
    text: choice?.message?.content ?? "",
    model: body.model ?? config.model,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
  };
}
