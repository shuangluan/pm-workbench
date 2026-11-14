// Local OpenAI-compatible mock for trying the model flows without a key or
// cost. Output is synthetic and only shaped like a real answer: never use it to
// judge analysis quality. Point the settings page at
// http://127.0.0.1:11555/v1 with "local model mode" on and any key.
// Exits by itself after MOCK_MODEL_TTL_SECONDS (default 20 minutes).

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 11555);
const TTL = Number(process.env.MOCK_MODEL_TTL_SECONDS ?? 1200);

interface Message {
  role: string;
  content: string | { type: string; text?: string }[];
}

const textOf = (m?: Message) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c) => c.text ?? "").join("\n"));

function abstraction(user: string) {
  const data = /Requests:\n([\s\S]*?)\n\nCitable sentences/.exec(user)?.[1] ?? "[]";
  const requests = JSON.parse(data) as { id: string; party: string; text: string }[];
  const evidence = [...user.matchAll(/\[(E\d+)\] "((?:[^"\\]|\\.)*)"/g)].map((m) => ({ handle: m[1]!, quote: JSON.parse(`"${m[2]}"`) as string }));
  const first = evidence[0];
  return {
    coverage: requests.map((r) => ({
      request: r.id,
      goal: `[mock] ${r.text.slice(0, 24)}`,
      shared: "[mock] shared need",
      specific: `[mock] constraints specific to ${r.party}`,
      handling: "shared_capability",
      evidence: [],
    })),
    claims: [
      {
        section: "common_problem",
        kind: "inference",
        text: `[mock] These ${requests.length} requests may point to the same problem.`,
        reasoning: "Fixed output from the mock model, not a real analysis.",
        missing: "",
        evidence: first ? [{ handle: first.handle, quote: "" }] : [],
        requests: requests.map((r) => r.id),
      },
      {
        section: "capability",
        kind: "suggestion",
        text: "[mock] Offer one entry point, move the differences into configuration, and keep permission constraints as fixed rules.",
        reasoning: "Fixed output from the mock model.",
        missing: "",
        evidence: [],
        requests: requests.map((r) => r.id),
      },
      ...(evidence[1] ? [{ section: "conflict", kind: "source_fact", text: `[mock] The source states: ${evidence[1].quote}`, reasoning: "", missing: "", evidence: [{ handle: evidence[1].handle, quote: "" }], requests: [] }] : []),
      { section: "risk", kind: "unknown", text: "[mock] The capacity limit cannot be determined.", reasoning: "", missing: "Ask the module owner to confirm the limit.", evidence: [], requests: [] },
    ],
  };
}

function split(user: string) {
  const body = /<data>\n([\s\S]*?)\n<\/data>/.exec(user)?.[1] ?? "";
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    requests: lines.map((line) => {
      const m = /^([^：:]{1,16})[：:]\s*(.+)$/.exec(line);
      return { party: m?.[1] ?? "", title: (m?.[2] ?? line).slice(0, 12), text: m?.[2] ?? line };
    }),
    questions: ["[mock] How often is this needed?"],
  };
}

function respond(system: string, user: string): unknown {
  if (system.includes("transcribe a chat screenshot")) return { transcript: "Sam (Finance): [mock transcript] Exports need to include the contract amount\nMe: For every role?\nSam (Finance): Only finance and management" };
  if (system.includes("split a piece of text")) return split(user);
  if (system.includes("shared capability")) return abstraction(user);
  return { ok: true };
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end("{}");
      return;
    }
    const body = JSON.parse(raw) as { model: string; messages: Message[] };
    const system = textOf(body.messages.find((m) => m.role === "system"));
    const user = textOf(body.messages.find((m) => m.role === "user"));
    const content = JSON.stringify(respond(system, user));
    // A short delay so queued and running states can be seen.
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: `mock:${body.model}`,
          choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
          usage: { prompt_tokens: Math.ceil(raw.length / 3), completion_tokens: Math.ceil(content.length / 3) },
        }),
      );
    }, 800);
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`Port ${PORT} is already in use, most likely by a mock model that is still running: you can use it as is.`);
  console.error("To start another one on a different port, set MOCK_MODEL_PORT.");
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock model on http://127.0.0.1:${PORT}/v1 (exits in ${TTL}s)`));
setTimeout(() => process.exit(0), TTL * 1000).unref();
