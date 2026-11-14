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
    return `${((s.bavail * s.bsize) / 1024 ** 3).toFixed(1)} GB free`;
  } catch {
    return "unknown";
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
      <h1>Settings</h1>
      <section className="card">
        <h2>Status</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{config.version} (preview)</dd>
          <dt>Database</dt>
          <dd>
            {handle.kind === "pglite" ? "Embedded Postgres (PGlite)" : "Postgres"} · <code>{handle.location}</code>
          </dd>
          <dt>Data directory</dt>
          <dd>
            <code>{config.dataDir}</code> · {freeSpace(config.dataDir)}
          </dd>
          <dt>Products</dt>
          <dd>{products!.n}</dd>
          <dt>Runs recorded</dt>
          <dd>{runs!.n}</dd>
          <dt>Network</dt>
          <dd>No telemetry and no update checks. Only tasks you start send the selected content, and only to the model service configured below.</dd>
        </dl>
      </section>
      <section className="card" id="model">
        <h2>Model</h2>
        <p>
          Use your own model account; you pay the provider directly. Configuring an endpoint allows it to receive task content: when you run an analysis, the selected requests, source excerpts or screenshots are sent to it. Uploading sources sends nothing.
        </p>
        <Form
          action={saveModelAction}
          submit="Save"
          advancedLabel="Limits and prices"
          fields={[
            {
              name: "adapter",
              label: "Interface",
              type: "select",
              defaultValue: model?.adapter ?? "anthropic_messages",
              options: [
                { value: "anthropic_messages", label: "Anthropic Messages" },
                { value: "openai_compatible", label: "OpenAI-compatible (chat/completions)" },
              ],
            },
            {
              name: "endpoint",
              label: "Endpoint",
              type: "text",
              required: true,
              defaultValue: model?.endpoint ?? defaults.endpoint,
              help: `Anthropic: ${ADAPTER_DEFAULTS.anthropic_messages.endpoint}. OpenAI-compatible: up to and including /v1, e.g. ${ADAPTER_DEFAULTS.openai_compatible.endpoint}`,
            },
            { name: "model", label: "Model ID", type: "text", required: true, defaultValue: model?.model ?? defaults.model, help: "Reading screenshots needs a model that accepts images." },
            {
              name: "apiKey",
              label: "API key",
              type: "password",
              autoComplete: "off",
              placeholder: model?.hasKey ? `Saved (${model.apiKeyHint ?? ""}); leave empty to keep it` : "",
              help: "Stored encrypted on this machine, never shown again, and never included in product exports.",
            },
            {
              name: "allowLocalHttp",
              type: "checkboxes",
              defaultValue: model?.allowLocalHttp ? ["yes"] : [],
              options: [{ value: "yes", label: "Local model mode: allow an HTTP endpoint on this machine (e.g. Ollama)" }],
            },
            { name: "contextLimit", label: "Context limit (tokens)", type: "number", advanced: true, defaultValue: String(model?.contextLimit ?? defaults.contextLimit) },
            { name: "outputLimit", label: "Output limit (tokens)", type: "number", advanced: true, defaultValue: String(model?.outputLimit ?? 16000), help: "Too low and results get cut off, which counts as a failed run." },
            { name: "timeoutSeconds", label: "Timeout per call (seconds)", type: "number", advanced: true, defaultValue: String(model?.timeoutSeconds ?? 120) },
            { name: "inputPricePerMillion", label: "Input price per million tokens (optional)", type: "text", advanced: true, defaultValue: model?.inputPricePerMillion ?? "", help: "Only used for estimates, not your actual bill." },
            { name: "outputPricePerMillion", label: "Output price per million tokens (optional)", type: "text", advanced: true, defaultValue: model?.outputPricePerMillion ?? "" },
          ]}
        />
        {model?.hasKey ? (
          <div className="actions-row section">
            <Form action={testModelAction} submit="Test connection" tone="secondary" inline fields={[]} />
            <Form action={removeModelKeyAction} submit="Remove key" tone="secondary" inline confirm="Remove the saved model key?" fields={[]} />
          </div>
        ) : null}
        <p className="help">The connection test sends a fixed short text with none of your material, at a tiny cost.</p>
      </section>
      <section className="card">
        <h2>Recent model calls</h2>
        {usage.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Task</th>
                  <th scope="col">Model</th>
                  <th scope="col">Attempt</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Input / output tokens</th>
                  <th scope="col">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id}>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td>{u.taskType ? (TASK_LABEL[u.taskType] ?? u.taskType) : "—"}</td>
                    <td>{u.model}</td>
                    <td>{u.attempt}</td>
                    <td>{(u.durationMs / 1000).toFixed(1)} s</td>
                    <td>
                      {u.inputTokens ?? "unknown"} / {u.outputTokens ?? "unknown"}
                    </td>
                    <td>{u.estimatedCost ? `$${Number(u.estimatedCost).toFixed(4)}` : "unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No model calls yet.</p>
        )}
        <p className="help">Costs are estimated from the prices you entered; your provider's bill is what counts. When a provider reports no usage, it shows as unknown.</p>
      </section>
      <section className="card">
        <h2>Backup and restore</h2>
        <p>
          To move a product, use Export product on its page and restore it as a new product on the Import page. There are no whole-instance backup scripts yet; see the manual steps in <code>docs/recovery.md</code>.
        </p>
        <p className="help">
          To reset the passphrase, run <code>npm run access:reset</code> in the project directory. All signed-in sessions end immediately.
        </p>
      </section>
    </>
  );
}
