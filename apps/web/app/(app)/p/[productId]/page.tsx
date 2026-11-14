import { getProduct, listAnalyses, listRequests, listSources, productDeletionPreview } from "@pew/db";
import Link from "next/link";
import { createAnalysisAction, deleteProductAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { ANALYSIS_STATUS, fmtDate, plural, VALIDITY } from "@/lib/labels";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const [analyses, sources, requests, preview] = await Promise.all([
    listAnalyses(db, productId),
    listSources(db, productId),
    listRequests(db, productId),
    productDeletionPreview(db, productId),
  ]);
  const base = `/p/${productId}`;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <span>{product.name}</span>
      </nav>
      <h1>
        {product.name}
        {product.isExample ? <span className="tag tag-example">Example</span> : null}
      </h1>
      {product.description ? <p className="muted">{product.description}</p> : null}

      <section className="section" id="analyses">
        <div className="section-head">
          <h2>Analyses</h2>
          <Link href={`/start?product=${productId}`} className="btn btn-primary">
            Quick start an analysis
          </Link>
        </div>
        {analyses.length ? (
          <ul className="list">
            {analyses.map((a) => (
              <li key={a.id}>
                <Link href={`${base}/a/${a.id}`}>{a.title}</Link>
                <span className={`tag tag-${a.status}`}>{ANALYSIS_STATUS[a.status]}</span>
                <span className="muted"> · updated {fmtDate(a.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No analyses yet.</p>
        )}
        <details className="disclosure">
          <summary>New analysis</summary>
          <Form
            action={createAnalysisAction}
            submit="Create analysis"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Unified bulk export" },
              { name: "goal", label: "Goal", type: "textarea", rows: 2 },
              { name: "changeDescription", label: "Change description (for the impact check)", type: "textarea", rows: 2 },
            ]}
          />
        </details>
      </section>

      <section className="section" id="requests">
        <div className="section-head">
          <h2>Requests</h2>
          <Link href={`${base}/requests/new`} className="btn btn-secondary">
            Add requests
          </Link>
        </div>
        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Party</th>
                  <th scope="col">Title</th>
                  <th scope="col">Original text</th>
                  <th scope="col">Version</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.party}</td>
                    <td>
                      <Link href={`${base}/requests/${r.id}`}>{(r.fields as Record<string, string>).title || "(untitled)"}</Link>
                    </td>
                    <td className="clip">{r.originalText ?? "[source deleted]"}</td>
                    <td>v{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No requests yet.</p>
        )}
      </section>

      <section className="section" id="sources">
        <div className="section-head">
          <h2>Sources</h2>
          <Link href={`${base}/sources/new`} className="btn btn-secondary">
            Add sources
          </Link>
        </div>
        {sources.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Current version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Size</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`${base}/sources/${s.id}`}>{s.name}</Link>
                      {s.kind === "image" ? <span className="tag">Screenshot</span> : s.kind === "transcript" ? <span className="tag">Transcript</span> : null}
                    </td>
                    <td>v{s.version}{s.versionCount > 1 ? <span className="muted"> ({plural(s.versionCount, "version")})</span> : null}</td>
                    <td>{VALIDITY[s.validity]}</td>
                    <td>{s.kind === "image" ? `${Math.ceil((s.byteSize ?? 0) / 1024)} KB` : plural(s.charCount, "character")}</td>
                    <td>{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No sources yet. Uploading a source never calls a model.</p>
        )}
      </section>

      <section className="section">
        <h2>Data</h2>
        <p>
          <a href={`${base}/export`} className="btn btn-secondary" download>
            Export product (ZIP)
          </a>
          <span className="help"> Includes requests, source text, claims, reports and checksums; never passphrases, sessions or model keys.</span>
        </p>
        <details className="disclosure danger-zone">
          <summary>Delete product</summary>
          <p>
            This permanently deletes {plural(preview.analyses, "analysis", "analyses")}, {plural(preview.reports, "report version")}, {plural(preview.requests, "request")} and {plural(preview.sources, "source")}. Files you exported and old backups are not affected.
          </p>
          <Form
            action={deleteProductAction}
            submit={product.isExample ? "Remove example" : "Delete product permanently"}
            tone="danger"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              ...(product.isExample
                ? []
                : [{ name: "confirmName", label: `Type the product name "${product.name}" to confirm`, type: "text" as const, required: true }]),
            ]}
          />
        </details>
      </section>
    </>
  );
}
