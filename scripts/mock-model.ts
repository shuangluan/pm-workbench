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
  const data = /需求：\n([\s\S]*?)\n\n可引用的原句/.exec(user)?.[1] ?? "[]";
  const requests = JSON.parse(data) as { id: string; party: string; text: string }[];
  const evidence = [...user.matchAll(/\[(E\d+)\] "((?:[^"\\]|\\.)*)"/g)].map((m) => ({ handle: m[1]!, quote: JSON.parse(`"${m[2]}"`) as string }));
  const first = evidence[0];
  return {
    coverage: requests.map((r) => ({
      request: r.id,
      goal: `【模拟】${r.text.slice(0, 16)}`,
      shared: "【模拟】共同诉求",
      specific: `【模拟】${r.party}的特有约束`,
      handling: "shared_capability",
      evidence: [],
    })),
    claims: [
      {
        section: "common_problem",
        kind: "inference",
        text: `【模拟】${requests.length} 条需求可能指向同一类问题。`,
        reasoning: "模拟模型的固定输出，不代表真实分析。",
        missing: "",
        evidence: first ? [{ handle: first.handle, quote: "" }] : [],
        requests: requests.map((r) => r.id),
      },
      {
        section: "capability",
        kind: "suggestion",
        text: "【模拟】建议提供统一入口，差异放到配置中，权限类约束保持固定规则。",
        reasoning: "模拟模型的固定输出。",
        missing: "",
        evidence: [],
        requests: requests.map((r) => r.id),
      },
      ...(evidence[1] ? [{ section: "conflict", kind: "source_fact", text: `【模拟】资料写明：${evidence[1].quote}`, reasoning: "", missing: "", evidence: [{ handle: evidence[1].handle, quote: "" }], requests: [] }] : []),
      { section: "risk", kind: "unknown", text: "【模拟】容量上限无法判断。", reasoning: "", missing: "请找模块负责人确认上限。", evidence: [], requests: [] },
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
    questions: ["【模拟】这个需求的使用频率是多少？"],
  };
}

function respond(system: string, user: string): unknown {
  if (system.includes("逐字转写")) return { transcript: "赵财务：【模拟转写】导出时要能带上合同金额\n我：所有角色都要吗？\n赵财务：只给财务和管理层" };
  if (system.includes("拆成独立的需求")) return split(user);
  if (system.includes("通用能力")) return abstraction(user);
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
