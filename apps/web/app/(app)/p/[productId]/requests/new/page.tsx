import { getProduct } from "@pew/db";
import Link from "next/link";
import { createRequestAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { requestFieldInputs } from "@/lib/request-fields";

export default async function NewRequestPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await found(getProduct(await getDb(), productId));
  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>录入需求</span>
      </nav>
      <h1>录入需求</h1>
      <p className="muted">原话单独保存、不会被整理字段覆盖。整理字段可以留空，留空即视为未知。“建议拆分”需要模型，将在后续版本提供。</p>
      <section className="card">
        <Form
          action={createRequestAction}
          submit="保存需求"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            // A new key per page load: resubmitting the same form cannot create a second request.
            { name: "batchKey", type: "hidden", defaultValue: crypto.randomUUID() },
            { name: "party", label: "业务方 / 业务线", type: "text", required: true },
            { name: "originalText", label: "原话", type: "textarea", rows: 6, required: true, maxLength: 20000, help: "最多 20,000 字符。" },
            { name: "sourceName", label: "来源名称", type: "text", placeholder: "例如：周会纪要" },
            { name: "originalUrl", label: "原始链接（只作记录，不会访问）", type: "text" },
            ...requestFieldInputs(),
            {
              name: "allowDuplicate",
              type: "checkboxes",
              options: [{ value: "yes", label: "原文相同也保存（不同提出者的同样诉求）" }],
            },
          ]}
        />
      </section>
    </>
  );
}
