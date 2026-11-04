import { getAnalysis, getProduct, getVersionWithEvidence } from "@pew/db";
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
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link>
        {analysis ? (
          <>
            {" "}
            / <Link href={`/p/${productId}/a/${analysis.id}?step=scope`}>{analysis.title}</Link>
          </>
        ) : null}{" "}
        / <span>录入需求</span>
      </nav>
      <h1>录入需求</h1>
      <p className="muted">
        粘贴聊天记录、表格或列表，先看拆分预览，确认后保存。原话会原样保存，不会被标题或整理字段覆盖。
        {analysis ? ` 保存后自动加入“${analysis.title}”的分析范围。` : ""}
      </p>
      {prefill?.derivedFromVersionId ? <p className="banner banner-info">已带入截图的转写内容。请检查拆分结果后保存。</p> : null}
      <section className="card">
        <BulkRequestsForm
          action={bulkCreateRequestsAction}
          productId={productId}
          analysisId={analysis?.id}
          batchKey={crypto.randomUUID()}
          initialText={prefill?.text ?? ""}
          sourceName={prefill?.derivedFromVersionId ? "截图转写" : undefined}
        />
      </section>

      <details className="disclosure">
        <summary>逐条录入（含整理字段）</summary>
        <section className="card">
          <Form
            action={createRequestAction}
            submit="保存需求"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "batchKey", type: "hidden", defaultValue: crypto.randomUUID() },
              { name: "party", label: "业务方 / 业务线", type: "text", required: true },
              { name: "originalText", label: "原话", type: "textarea", rows: 6, required: true, maxLength: 20000 },
              { name: "sourceName", label: "来源名称", type: "text", placeholder: "例如：周会纪要" },
              { name: "originalUrl", label: "原始链接（只作记录，不会访问）", type: "text" },
              ...requestFieldInputs(),
              { name: "allowDuplicate", type: "checkboxes", options: [{ value: "yes", label: "原文相同也保存（不同提出者的同样诉求）" }] },
            ]}
          />
        </section>
      </details>
    </>
  );
}
