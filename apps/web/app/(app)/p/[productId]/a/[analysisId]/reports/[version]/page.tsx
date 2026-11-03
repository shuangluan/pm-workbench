import { renderReportMarkdown } from "@pew/core";
import { getAnalysis, getProduct, getReportVersion } from "@pew/db";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { fmtDate, REPORT_STATUS } from "@/lib/labels";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string; analysisId: string; version: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { productId, analysisId, version } = await params;
  const lang = (await searchParams).lang === "en" ? "en" : "zh";
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const analysis = await found(getAnalysis(db, productId, analysisId));
  const report = await found(getReportVersion(db, productId, analysisId, Number(version)));
  const md = renderReportMarkdown(report.snapshot, lang);
  const exportBase = `/p/${productId}/a/${analysisId}/reports/${version}/export`;

  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> /{" "}
        <Link href={`/p/${productId}/a/${analysisId}?step=report`}>{analysis.title}</Link> / <span>报告 v{report.version}</span>
      </nav>
      <h1>报告 v{report.version}</h1>
      <p className="muted">
        {REPORT_STATUS[report.status]} · 保存于 {fmtDate(report.createdAt)} · 不可修改的快照
      </p>
      <p className="actions-row">
        <a className="btn btn-primary" href={`${exportBase}?kind=report&lang=${lang}`} download>
          下载分析报告（Markdown）
        </a>
        <a className="btn btn-secondary" href={`${exportBase}?kind=spec&lang=${lang}`} download>
          下载精简规格（Markdown）
        </a>
        <Link href={`?lang=${lang === "zh" ? "en" : "zh"}`}>{lang === "zh" ? "English headings" : "中文标题"}</Link>
      </p>
      <p className="help">标题语言可切换；原始证据不翻译，避免引用失真。</p>
      <pre className="markdown">{md}</pre>
    </>
  );
}
