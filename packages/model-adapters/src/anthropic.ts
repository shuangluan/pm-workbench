// Anthropic Messages adapter, via the official SDK. Retries are off here so the
// run policy (at most one automatic retry, every attempt recorded) stays in
// one place. Server-side model fallbacks are deliberately not enabled: a run
// must not silently switch models (PRD §7.2).

import Anthropic from "@anthropic-ai/sdk";
import { noRedirectFetch, validateEndpoint } from "./endpoint";
import { ModelError, type ModelEndpoint, type ModelRequest, type ModelResponse } from "./types";

function mapError(err: unknown): ModelError {
  if (err instanceof Anthropic.APIUserAbortError) return new ModelError("canceled", "Canceled");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ModelError("outcome_unknown", "The request timed out; the provider may already have run and billed it");
  if (err instanceof Anthropic.APIConnectionError) return new ModelError("network", "Cannot reach the model service");
  if (err instanceof Anthropic.AuthenticationError) return new ModelError("auth", "The key was rejected", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new ModelError("auth", "This key is not allowed to use this model", 403);
  if (err instanceof Anthropic.NotFoundError) return new ModelError("model_not_found", "The model does not exist, or this account cannot use it", 404);
  if (err instanceof Anthropic.RateLimitError) return new ModelError("rate_limited", "Too many requests, or the quota is used up", 429);
  if (err instanceof Anthropic.BadRequestError) return new ModelError("unsupported_format", `The model service rejected the request: ${err.message}`.slice(0, 300), 400);
  if (err instanceof Anthropic.InternalServerError) return new ModelError("network", "The model service is temporarily unavailable", err.status);
  if (err instanceof Anthropic.APIError) return new ModelError("network", `The model service returned error ${err.status ?? ""}`.trim(), err.status);
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
  if (response.stop_reason === "refusal") throw new ModelError("refused", "The model refused this request");
  if (response.stop_reason === "max_tokens") throw new ModelError("truncated", "The output was cut off; raise the output limit under Settings");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}
