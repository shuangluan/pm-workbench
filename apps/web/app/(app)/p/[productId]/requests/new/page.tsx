import { getAnalysis, getModelConfig, getProduct, getVersionWithEvidence } from "@pew/db";
import Link from "next/link";
import { bulkCreateRequestsAction, createRequestAction } from "@/app/actions";
import { BulkRequestsForm } from "@/components/BulkRequestsForm";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { requestFieldInputs } from "@/lib/request-fields";

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ analysis?: string; from?: string }>;
}) {
  const { productId } = await params;
  const { analysis: analysisId, from } = await searchParams;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const analysis = analysisId ? await found(getAnalysis(db, productId, analysisId)) : null;
  // Prefill from a transcript, e.g. text read from a chat screenshot.
  const prefill = from ? (await found(getVersionWithEvidence(db, productId, from))).version : null;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={`/p/${productId}`}>{product.name}</Link>
        {analysis ? (
          <>
            {" "}
            / <Link href={`/p/${productId}/a/${analysis.id}?step=scope`}>{analysis.title}</Link>
          </>
        ) : null}{" "}
        / <span>Add requests</span>
      </nav>
      <h1>Add requests</h1>
      <p className="muted">
        Paste a chat log, table or list, check the split preview, then save. The original text is kept exactly as written; titles and other fields never overwrite it.
        {analysis ? ` Saved requests join "${analysis.title}".` : ""}
      </p>
      {prefill?.derivedFromVersionId ? <p className="banner banner-info">The screenshot transcript is filled in. Check the split before saving.</p> : null}
      <section className="card">
        <BulkRequestsForm
          action={bulkCreateRequestsAction}
          productId={productId}
          analysisId={analysis?.id}
          batchKey={crypto.randomUUID()}
          initialText={prefill?.text ?? ""}
          sourceName={prefill?.derivedFromVersionId ? "Screenshot transcript" : undefined}
          modelReady={!!(await getModelConfig(db))?.hasKey}
        />
      </section>

      <details className="disclosure">
        <summary>Add one request with all fields</summary>
        <section className="card">
          <Form
            action={createRequestAction}
            submit="Save request"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "batchKey", type: "hidden", defaultValue: crypto.randomUUID() },
              { name: "party", label: "Party or business line", type: "text", required: true },
              { name: "originalText", label: "Original text", type: "textarea", rows: 6, required: true, maxLength: 20000 },
              { name: "sourceName", label: "Source name", type: "text", placeholder: "e.g. Weekly sync notes" },
              { name: "originalUrl", label: "Original link (recorded only, never fetched)", type: "text" },
              ...requestFieldInputs(),
              { name: "allowDuplicate", type: "checkboxes", options: [{ value: "yes", label: "Save even if the text already exists (same ask from a different party)" }] },
            ]}
          />
        </section>
      </details>
    </>
  );
}
