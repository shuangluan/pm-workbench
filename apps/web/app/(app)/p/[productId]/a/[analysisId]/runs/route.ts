import { listRuns } from "@pew/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/route-guard";

// Polled by the page while a model run is active.
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string; analysisId: string }> }) {
  return guarded(async () => {
    const { productId, analysisId } = await params;
    const runs = await listRuns(await getDb(), productId, analysisId);
    return NextResponse.json(runs.map(({ scope: _s, ...r }) => r), { headers: { "Cache-Control": "no-store" } });
  });
}
