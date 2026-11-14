import { getProduct } from "@pew/db";
import Link from "next/link";
import { addSourcesAction, uploadImagesAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { ScreenshotUploadForm } from "@/components/ScreenshotUploadForm";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";

export default async function NewSourcePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await found(getProduct(await getDb(), productId));
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>Add sources</span>
      </nav>
      <h1>Add sources</h1>
      <p className="muted">
        UTF-8 TXT or Markdown, or pasted text. Up to 2 MB and 100,000 characters per file, 10 files at a time. Identical content is reused rather than stored twice, and uploading never calls a model.
      </p>
      <section className="card">
        <h2>Chat screenshots</h2>
        <ScreenshotUploadForm action={uploadImagesAction} productId={productId} />
      </section>
      <section className="card">
        <h2>Text sources</h2>
        <Form
          action={addSourcesAction}
          submit="Save"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "files", label: "Upload files", type: "file", multiple: true, accept: ".txt,.md,.markdown,text/plain,text/markdown" },
            { name: "name", label: "Name of the pasted source", type: "text", placeholder: "e.g. Permission rules" },
            { name: "text", label: "Or paste text", type: "textarea", rows: 12, mono: true },
            { name: "originalUrl", label: "Original link (recorded only, never fetched)", type: "text" },
          ]}
        />
      </section>
    </>
  );
}
