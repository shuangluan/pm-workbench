import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError, inspectProductArchive, type ArchiveSummary } from "@pew/db";
import Link from "next/link";
import { confirmImportAction, inspectImportAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { config } from "@/lib/config";

const LABELS: Record<string, string> = {
  requests: "Requests",
  sources: "Sources (including request texts)",
  source_versions: "Source versions",
  evidences: "Citations",
  analyses: "Analyses",
  claims: "Claims",
  report_versions: "Report versions",
  system_nodes: "Nodes",
  system_edges: "Relations",
  decisions: "Decisions",
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let summary: ArchiveSummary | null = null;
  let error: string | null = null;
  if (token && /^[0-9a-f-]{36}$/.test(token)) {
    try {
      summary = inspectProductArchive(new Uint8Array(readFileSync(join(config.dataDir, "imports", `${token}.zip`)))).summary;
    } catch (err) {
      error = err instanceof AppError ? err.message : "The file to import has expired; upload it again";
    }
  }

  return (
    <>
      <h1>Import a product</h1>
      <p className="muted">Import always creates a new product and never overwrites an existing one. All ids are reassigned, and external links are kept only as records.</p>
      {summary ? (
        <section className="card">
          <h2>Import "{summary.productName}"?</h2>
          <p className="muted">Exported {summary.exportedAt}. Checksums and source hashes all match.</p>
          <ul className="list compact">
            {Object.entries(LABELS).map(([k, label]) => (
              <li key={k}>
                {label}: {summary.counts[k] ?? 0}
              </li>
            ))}
          </ul>
          <Form action={confirmImportAction} submit="Import as a new product" fields={[{ name: "token", type: "hidden", defaultValue: token }]} />
          <p>
            <Link href="/import">Choose another file</Link>
          </p>
        </section>
      ) : (
        <section className="card">
          {error ? <p className="error">{error}</p> : null}
          <Form
            action={inspectImportAction}
            submit="Check file"
            fields={[
              {
                name: "archive",
                label: "Product export (.zip)",
                type: "file",
                accept: ".zip,application/zip",
                required: true,
                help: "Limits: 100 MB compressed, 200 MB uncompressed, 2,000 files. The file is checked before you confirm.",
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
