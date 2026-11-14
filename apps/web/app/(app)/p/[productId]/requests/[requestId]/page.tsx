import { getProduct, getRequest } from "@pew/db";
import Link from "next/link";
import { correctRequestTextAction, updateRequestAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { fmtDate, VALIDITY } from "@/lib/labels";
import { requestFieldInputs } from "@/lib/request-fields";

export default async function RequestPage({ params }: { params: Promise<{ productId: string; requestId: string }> }) {
  const { productId, requestId } = await params;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const r = await found(getRequest(db, productId, requestId));
  const fields = r.fields as Record<string, string>;
  const hidden = [
    { name: "productId", type: "hidden" as const, defaultValue: productId },
    { name: "requestId", type: "hidden" as const, defaultValue: requestId },
    { name: "revision", type: "hidden" as const, defaultValue: String(r.revision) },
  ];
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>{fields.title || "Request"}</span>
      </nav>
      <h1>{fields.title || "(untitled request)"}</h1>
      <p className="muted">
        {r.party} · created {fmtDate(r.createdAt)} · original text v{r.version} ({VALIDITY[r.validity]})
        {r.sourceName ? ` · source: ${r.sourceName}` : ""}
      </p>
      <blockquote className="verbatim">{r.originalText ?? "[source deleted]"}</blockquote>
      <p>
        <Link href={`/p/${productId}/sources/${r.sourceId}`}>See all versions of the original text</Link>
      </p>

      <div className="grid-2">
        <section className="card">
          <h2>Fields</h2>
          <Form
            action={updateRequestAction}
            submit="Save"
            fields={[...hidden, { name: "party", label: "Party", type: "text", required: true, defaultValue: r.party }, ...requestFieldInputs(fields)]}
          />
        </section>
        <section className="card">
          <h2>Correct the original text</h2>
          <p className="help">A correction creates a new version. Claims citing the old text keep pointing at it and are marked for review.</p>
          <Form
            action={correctRequestTextAction}
            submit="Save as new version"
            tone="secondary"
            fields={[...hidden, { name: "originalText", label: "Original text", type: "textarea", rows: 6, required: true, defaultValue: r.originalText ?? "" }]}
          />
        </section>
      </div>
    </>
  );
}
