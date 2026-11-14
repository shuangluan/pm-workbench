import { renderReportMarkdown } from "@pew/core";
import { getAnalysis, getProduct, getReportVersion } from "@pew/db";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { fmtDate, REPORT_STATUS } from "@/lib/labels";

export default async function ReportPage({ params }: { params: Promise<{ productId: string; analysisId: string; version: string }> }) {
  const { productId, analysisId, version } = await params;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const analysis = await found(getAnalysis(db, productId, analysisId));
  const report = await found(getReportVersion(db, productId, analysisId, Number(version)));
  const md = renderReportMarkdown(report.snapshot, "en");
  const exportBase = `/p/${productId}/a/${analysisId}/reports/${version}/export`;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> /{" "}
        <Link href={`/p/${productId}/a/${analysisId}?step=report`}>{analysis.title}</Link> / <span>Report v{report.version}</span>
      </nav>
      <h1>Report v{report.version}</h1>
      <p className="muted">
        {REPORT_STATUS[report.status]} · saved {fmtDate(report.createdAt)} · a snapshot that cannot be changed
      </p>
      <p className="actions-row">
        <a className="btn btn-primary" href={`${exportBase}?kind=report`} download>
          Download report (Markdown)
        </a>
        <a className="btn btn-secondary" href={`${exportBase}?kind=spec`} download>
          Download spec summary (Markdown)
        </a>
      </p>
      <p className="help">Quoted evidence is kept in its original language so citations stay exact.</p>
      <pre className="markdown">{md}</pre>
    </>
  );
}
