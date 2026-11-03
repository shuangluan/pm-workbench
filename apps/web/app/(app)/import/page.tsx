import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError, inspectProductArchive, type ArchiveSummary } from "@pew/db";
import Link from "next/link";
import { confirmImportAction, inspectImportAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { config } from "@/lib/config";

const LABELS: Record<string, string> = {
  requests: "需求",
  sources: "资料（含需求原话）",
  source_versions: "资料版本",
  evidences: "引用",
  analyses: "分析",
  claims: "条目",
  report_versions: "报告版本",
  system_nodes: "节点",
  system_edges: "关系",
  decisions: "决策",
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let summary: ArchiveSummary | null = null;
  let error: string | null = null;
  if (token && /^[0-9a-f-]{36}$/.test(token)) {
    try {
      summary = inspectProductArchive(new Uint8Array(readFileSync(join(config.dataDir, "imports", `${token}.zip`)))).summary;
    } catch (err) {
      error = err instanceof AppError ? err.message : "待导入的文件已过期，请重新上传";
    }
  }

  return (
    <>
      <h1>导入产品</h1>
      <p className="muted">导入总是创建一个新产品，不会覆盖已有产品。所有 ID 会重新分配，外部链接只作为记录保存。</p>
      {summary ? (
        <section className="card">
          <h2>确认导入“{summary.productName}”</h2>
          <p className="muted">导出于 {summary.exportedAt}，校验和与资料哈希均已通过。</p>
          <ul className="list compact">
            {Object.entries(LABELS).map(([k, label]) => (
              <li key={k}>
                {label}：{summary.counts[k] ?? 0}
              </li>
            ))}
          </ul>
          <Form action={confirmImportAction} submit="导入为新产品" fields={[{ name: "token", type: "hidden", defaultValue: token }]} />
          <p>
            <Link href="/import">换一个文件</Link>
          </p>
        </section>
      ) : (
        <section className="card">
          {error ? <p className="error">{error}</p> : null}
          <Form
            action={inspectImportAction}
            submit="检查文件"
            fields={[
              {
                name: "archive",
                label: "产品导出包（.zip）",
                type: "file",
                accept: ".zip,application/zip",
                required: true,
                help: "上限：压缩包 100 MB、解压后 200 MB、2,000 个文件。先检查，再确认导入。",
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
