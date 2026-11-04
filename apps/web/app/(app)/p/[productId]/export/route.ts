import { exportProduct } from "@pew/db";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { attachment, guarded } from "@/lib/route-guard";

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  return guarded(async () => {
    const { productId } = await params;
    const { filename, bytes } = await exportProduct(await getDb(), config.dataDir, productId);
    return attachment(new Blob([bytes as BlobPart]), filename, "application/zip");
  });
}
