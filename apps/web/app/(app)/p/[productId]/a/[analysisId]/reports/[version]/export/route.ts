import { getReportVersion, renderReport } from "@pew/db";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { attachment, guarded } from "@/lib/route-guard";

export async function GET(request: NextRequest, { params }: { params: Promise<{ productId: string; analysisId: string; version: string }> }) {
  return guarded(async () => {
    const { productId, analysisId, version } = await params;
    const kind = request.nextUrl.searchParams.get("kind") === "spec" ? "spec" : "report";
    const lang = "en";
    const report = await getReportVersion(await getDb(), productId, analysisId, Number(version));
    const name = `${report.snapshot.title}-${kind === "spec" ? "spec" : "report"}-v${report.version}.md`;
    return attachment(renderReport(report.snapshot, kind, lang), name, "text/markdown; charset=utf-8");
  });
}
