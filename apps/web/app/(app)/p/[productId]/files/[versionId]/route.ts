import { readImage } from "@pew/db";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/route-guard";

// Serves a stored screenshot with its sniffed type. The CSP and nosniff header
// keep the browser from treating the bytes as anything but an image.
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string; versionId: string }> }) {
  return guarded(async () => {
    const { productId, versionId } = await params;
    const { bytes, mediaType } = await readImage(await getDb(), config.dataDir, productId, versionId);
    return new Response(new Blob([bytes as BlobPart]), {
      headers: {
        "Content-Type": mediaType,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
