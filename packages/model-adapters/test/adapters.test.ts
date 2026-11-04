// Contract tests against local fake servers: no network, no real keys.

import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { callModel, ModelError, validateEndpoint, type AdapterName, type ModelEndpoint, type ModelRequest } from "@pew/model-adapters";

let server: Server | undefined;
const seen: { url: string; headers: Record<string, unknown>; body: any }[] = [];

afterEach(() => {
  server?.close();
  server = undefined;
  seen.length = 0;
});

async function serve(handler: (body: any, url: string) => { status?: number; json?: unknown; location?: string; hang?: boolean }) {
  const listener: RequestListener = (req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      const r = handler(body, req.url ?? "");
      if (r.hang) return;
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json", ...(r.location ? { Location: r.location } : {}) });
      res.end(JSON.stringify(r.json ?? {}));
    });
  };
  server = createServer(listener);
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const config = (adapter: AdapterName, endpoint: string, extra: Partial<ModelEndpoint> = {}): ModelEndpoint => ({
  adapter,
  endpoint,
  model: "test-model",
  apiKey: "test-key",
  outputLimit: 1000,
  timeoutMs: 2000,
  allowLocalHttp: true,
  ...extra,
});

const request: ModelRequest = {
  system: "sys",
  text: "hello",
  images: [{ mediaType: "image/png", base64: "AAAA" }],
  schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  schemaName: "t",
};

const kind = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ModelError) return err.kind;
    throw err;
  }
  return "ok";
};

const anthropicOk = (extra = {}) => ({
  json: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "reported-model",
    content: [{ type: "text", text: '{"a":1}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 7 },
    ...extra,
  },
});

describe("Anthropic adapter", () => {
  it("sends schema, system and base64 image, and reports usage", async () => {
    const url = await serve(() => anthropicOk());
    const r = await callModel(config("anthropic_messages", url), request);
    expect(r).toEqual({ text: '{"a":1}', model: "reported-model", inputTokens: 11, outputTokens: 7 });
    const [{ url: path, headers, body }] = seen as [(typeof seen)[number]];
    expect(path).toBe("/v1/messages");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: request.schema });
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
    // No server-side model fallback: a run must not silently change models.
    expect(body.fallbacks).toBeUndefined();
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "model_not_found"],
    [429, "rate_limited"],
    [400, "unsupported_format"],
    [500, "network"],
  ])("maps HTTP %i to %s without retrying", async (status, expected) => {
    const url = await serve(() => ({ status, json: { type: "error", error: { type: "x", message: "m" } } }));
    expect(await kind(callModel(config("anthropic_messages", url), request))).toBe(expected);
    expect(seen).toHaveLength(1);
  });

  it("treats refusal and truncation as failures, not results", async () => {
    let url = await serve(() => anthropicOk({ stop_reason: "refusal" }));
    expect(await kind(callModel(config("anthropic_messages", url), request))).toBe("refused");
    server!.close();
    url = await serve(() => anthropicOk({ stop_reason: "max_tokens" }));
    expect(await kind(callModel(config("anthropic_messages", url), request))).toBe("truncated");
  });

  it("reports a timeout as outcome unknown", async () => {
    const url = await serve(() => ({ hang: true }));
    expect(await kind(callModel(config("anthropic_messages", url, { timeoutMs: 100 }), request))).toBe("outcome_unknown");
    expect(seen).toHaveLength(1);
  });
});

describe("OpenAI-compatible adapter", () => {
  const ok = { json: { model: "m", choices: [{ finish_reason: "stop", message: { content: '{"a":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } } };

  it("sends a JSON schema format and a data URL image", async () => {
    const url = await serve(() => ok);
    const r = await callModel(config("openai_compatible", url), request);
    expect(r).toMatchObject({ text: '{"a":1}', inputTokens: 5, outputTokens: 2 });
    const [{ url: path, headers, body }] = seen as [(typeof seen)[number]];
    expect(path).toBe("/chat/completions");
    expect(headers.authorization).toBe("Bearer test-key");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[1].content[0].image_url.url).toBe("data:image/png;base64,AAAA");
  });

  it("leaves token counts undefined when the server reports none", async () => {
    const url = await serve(() => ({ json: { choices: [{ message: { content: "{}" } }] } }));
    const r = await callModel(config("openai_compatible", url), request);
    expect(r.inputTokens).toBeUndefined();
    expect(r.outputTokens).toBeUndefined();
  });

  it("falls back to json_object when the server refuses schemas", async () => {
    const url = await serve((body) => (body.response_format.type === "json_schema" ? { status: 400, json: { error: "response_format not supported" } } : ok));
    await callModel(config("openai_compatible", url), request);
    expect(seen.map((s) => s.body.response_format.type)).toEqual(["json_schema", "json_object"]);
    expect(seen[1]!.body.messages[0].content).toContain("JSON Schema");
  });

  it("uses max_completion_tokens when the server asks for it", async () => {
    const url = await serve((body) => (body.max_tokens ? { status: 400, json: { error: "use max_completion_tokens" } } : ok));
    await callModel(config("openai_compatible", url), request);
    expect(seen[1]!.body.max_completion_tokens).toBe(1000);
  });

  it("maps errors, truncation and timeouts", async () => {
    let url = await serve(() => ({ status: 401 }));
    expect(await kind(callModel(config("openai_compatible", url), request))).toBe("auth");
    server!.close();
    url = await serve(() => ({ json: { choices: [{ finish_reason: "length", message: { content: "{" } }] } }));
    expect(await kind(callModel(config("openai_compatible", url), request))).toBe("truncated");
    server!.close();
    url = await serve(() => ({ hang: true }));
    expect(await kind(callModel(config("openai_compatible", url, { timeoutMs: 100 }), request))).toBe("outcome_unknown");
  });
});

describe("endpoint safety", () => {
  it.each(["anthropic_messages", "openai_compatible"] as const)("%s does not follow redirects, so the key stays put", async (adapter) => {
    let hits = 0;
    const target = createServer((_q, s) => {
      hits++;
      s.end("{}");
    });
    await new Promise<void>((ok) => target.listen(0, "127.0.0.1", ok));
    const elsewhere = `http://127.0.0.1:${(target.address() as AddressInfo).port}/v1/messages`;
    const url = await serve(() => ({ status: 302, location: elsewhere }));
    expect(await kind(callModel(config(adapter, url), request))).not.toBe("ok");
    target.close();
    expect(hits).toBe(0);
  });

  it("accepts HTTPS and refuses metadata, credentials and remote HTTP", () => {
    expect(validateEndpoint("https://api.anthropic.com", false).host).toBe("api.anthropic.com");
    expect(validateEndpoint("http://127.0.0.1:11434/v1", true).port).toBe("11434");
    for (const [url, local] of [
      ["http://127.0.0.1:1", false],
      ["http://example.com", true],
      ["https://169.254.169.254/latest", false],
      ["http://2852039166/", true],
      ["https://metadata.google.internal", false],
      ["https://user:pw@example.com", false],
      ["ftp://example.com", true],
      ["not a url", false],
    ] as const) {
      expect(() => validateEndpoint(url, local), url).toThrow(ModelError);
    }
  });
});
