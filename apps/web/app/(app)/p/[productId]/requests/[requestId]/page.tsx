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
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>{fields.title || "需求"}</span>
      </nav>
      <h1>{fields.title || "（未命名需求）"}</h1>
      <p className="muted">
        {r.party} · 创建于 {fmtDate(r.createdAt)} · 原话 v{r.version}（{VALIDITY[r.validity]}）
        {r.sourceName ? ` · 来源：${r.sourceName}` : ""}
      </p>
      <blockquote className="verbatim">{r.originalText ?? "［来源已删除］"}</blockquote>
      <p>
        <Link href={`/p/${productId}/sources/${r.sourceId}`}>查看原话的全部版本</Link>
      </p>

      <div className="grid-2">
        <section className="card">
          <h2>整理字段</h2>
          <Form
            action={updateRequestAction}
            submit="保存"
            fields={[...hidden, { name: "party", label: "业务方", type: "text", required: true, defaultValue: r.party }, ...requestFieldInputs(fields)]}
          />
        </section>
        <section className="card">
          <h2>修正原话</h2>
          <p className="help">修正会生成新版本。引用旧原话的结论保持指向旧版本并提示复核。</p>
          <Form
            action={correctRequestTextAction}
            submit="保存为新版本"
            tone="secondary"
            fields={[...hidden, { name: "originalText", label: "原话", type: "textarea", rows: 6, required: true, defaultValue: r.originalText ?? "" }]}
          />
        </section>
      </div>
    </>
  );
}
