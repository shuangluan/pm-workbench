import { statfsSync } from "node:fs";
import { getModelConfig, listUsage, schema } from "@pew/db";
import { ADAPTER_DEFAULTS } from "@pew/model-adapters";
import { count } from "drizzle-orm";
import { removeModelKeyAction, saveModelAction, testModelAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { config } from "@/lib/config";
import { getDb, getHandle } from "@/lib/db";
import { fmtDate } from "@/lib/labels";
import { TASK_LABEL } from "@/lib/runs-ui";

function freeSpace(path: string): string {
  try {
    const s = statfsSync(path);
    return `${((s.bavail * s.bsize) / 1024 ** 3).toFixed(1)} GB 可用`;
  } catch {
    return "未知";
  }
}

export default async function SettingsPage() {
  const handle = await getHandle();
  const db = await getDb();
  const [products] = await db.select({ n: count() }).from(schema.products);
  const [runs] = await db.select({ n: count() }).from(schema.analysisRuns);
  const model = await getModelConfig(db);
  const usage = await listUsage(db);
  const defaults = ADAPTER_DEFAULTS[model?.adapter ?? "anthropic_messages"];

  return (
    <>
      <h1>设置与诊断</h1>
      <section className="card">
        <h2>运行状态</h2>
        <dl className="kv">
          <dt>软件版本</dt>
          <dd>{config.version}（预览版）</dd>
          <dt>数据库</dt>
          <dd>
            {handle.kind === "pglite" ? "内嵌 Postgres（PGlite）" : "Postgres"} · <code>{handle.location}</code>
          </dd>
          <dt>数据目录</dt>
          <dd>
            <code>{config.dataDir}</code> · {freeSpace(config.dataDir)}
          </dd>
          <dt>产品数</dt>
          <dd>{products!.n}</dd>
          <dt>任务记录</dt>
          <dd>{runs!.n}</dd>
          <dt>网络</dt>
          <dd>无遥测、无自动更新检查。只有你点击运行的任务，才会把所选内容发送给下方配置的模型服务。</dd>
        </dl>
      </section>
      <section className="card" id="model">
        <h2>模型</h2>
        <p>
          使用你自己的模型账号，费用由你直接支付给服务商。配置后，这个端点相当于被允许接收任务内容：运行分析时，所选的需求、资料片段或截图会发送给它。上传资料本身不会触发发送。
        </p>
        <Form
          action={saveModelAction}
          submit="保存"
          advancedLabel="限额与单价"
          fields={[
            {
              name: "adapter",
              label: "接口类型",
              type: "select",
              defaultValue: model?.adapter ?? "anthropic_messages",
              options: [
                { value: "anthropic_messages", label: "Anthropic Messages" },
                { value: "openai_compatible", label: "OpenAI 兼容（chat/completions）" },
              ],
            },
            {
              name: "endpoint",
              label: "端点",
              type: "text",
              required: true,
              defaultValue: model?.endpoint ?? defaults.endpoint,
              help: `Anthropic：${ADAPTER_DEFAULTS.anthropic_messages.endpoint}；OpenAI 兼容：填到 /v1 为止，如 ${ADAPTER_DEFAULTS.openai_compatible.endpoint}`,
            },
            { name: "model", label: "模型 ID", type: "text", required: true, defaultValue: model?.model ?? defaults.model, help: "读取截图需要支持图片输入的模型。" },
            {
              name: "apiKey",
              label: "API 密钥",
              type: "password",
              autoComplete: "off",
              placeholder: model?.hasKey ? `已保存 ${model.apiKeyHint ?? ""}，留空则不修改` : "",
              help: "加密保存在本机，保存后不再显示，也不会进入产品导出包。",
            },
            {
              name: "allowLocalHttp",
              type: "checkboxes",
              defaultValue: model?.allowLocalHttp ? ["yes"] : [],
              options: [{ value: "yes", label: "本地模型模式：允许使用本机的 HTTP 端点（如 Ollama）" }],
            },
            { name: "contextLimit", label: "上下文上限（tokens）", type: "number", advanced: true, defaultValue: String(model?.contextLimit ?? defaults.contextLimit) },
            { name: "outputLimit", label: "输出上限（tokens）", type: "number", advanced: true, defaultValue: String(model?.outputLimit ?? 16000), help: "过低会导致结果被截断，任务按失败处理。" },
            { name: "timeoutSeconds", label: "单次调用超时（秒）", type: "number", advanced: true, defaultValue: String(model?.timeoutSeconds ?? 120) },
            { name: "inputPricePerMillion", label: "输入单价（每百万 tokens，可选）", type: "text", advanced: true, defaultValue: model?.inputPricePerMillion ?? "", help: "只用于估算，不等于实际账单。" },
            { name: "outputPricePerMillion", label: "输出单价（每百万 tokens，可选）", type: "text", advanced: true, defaultValue: model?.outputPricePerMillion ?? "" },
          ]}
        />
        {model?.hasKey ? (
          <div className="actions-row section">
            <Form action={testModelAction} submit="测试连接" tone="secondary" inline fields={[]} />
            <Form action={removeModelKeyAction} submit="删除密钥" tone="secondary" inline confirm="删除已保存的模型密钥？" fields={[]} />
          </div>
        ) : null}
        <p className="help">测试连接只发送一段固定的英文文本，不包含你的资料，会产生极少量费用。</p>
      </section>
      <section className="card">
        <h2>最近的模型调用</h2>
        {usage.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">任务</th>
                  <th scope="col">模型</th>
                  <th scope="col">第几次</th>
                  <th scope="col">耗时</th>
                  <th scope="col">输入 / 输出 tokens</th>
                  <th scope="col">估算费用</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id}>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td>{u.taskType ? (TASK_LABEL[u.taskType] ?? u.taskType) : "—"}</td>
                    <td>{u.model}</td>
                    <td>{u.attempt}</td>
                    <td>{(u.durationMs / 1000).toFixed(1)} 秒</td>
                    <td>
                      {u.inputTokens ?? "未知"} / {u.outputTokens ?? "未知"}
                    </td>
                    <td>{u.estimatedCost ? `$${Number(u.estimatedCost).toFixed(4)}` : "未知"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">还没有调用记录。</p>
        )}
        <p className="help">费用是按你填写的单价估算的，以服务商账单为准。没有返回用量时显示“未知”。</p>
      </section>
      <section className="card">
        <h2>备份与恢复</h2>
        <p>
          产品级迁移：在产品页“导出产品”，在“导入”页恢复为新产品。整实例备份与恢复脚本尚未提供，见 <code>docs/recovery.md</code> 中的手工步骤。
        </p>
        <p className="help">
          重置访问口令：在项目目录运行 <code>npm run access:reset</code>，所有已登录会话立即失效。
        </p>
      </section>
    </>
  );
}
