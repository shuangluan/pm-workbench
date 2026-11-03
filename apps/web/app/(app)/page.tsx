import { findExampleProduct, listProducts } from "@pew/db";
import Link from "next/link";
import { createProductAction, loadExampleAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { fmtDate } from "@/lib/labels";

export default async function ProductsPage() {
  const db = await getDb();
  const products = await listProducts(db);
  const example = await findExampleProduct(db);

  return (
    <>
      <h1>产品</h1>
      <p className="muted">每个产品有独立的资料、需求、局部记忆和分析。产品之间不会互相引用。</p>

      {products.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">分析</th>
                <th scope="col">资料</th>
                <th scope="col">最近任务</th>
                <th scope="col">更新</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/p/${p.id}`}>{p.name}</Link>
                    {p.isExample ? <span className="tag tag-example">示例</span> : null}
                  </td>
                  <td>{p.analysisCount}</td>
                  <td>{p.sourceCount}</td>
                  <td>{fmtDate(p.lastAnalysisAt)}</td>
                  <td>{fmtDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">还没有产品。可以先看示例，或直接创建。</p>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>创建产品</h2>
          <Form
            action={createProductAction}
            submit="创建"
            fields={[
              { name: "name", label: "产品名称", type: "text", required: true, maxLength: 120, placeholder: "例如：客户管理平台" },
              { name: "description", label: "说明", type: "textarea", rows: 2 },
            ]}
          />
        </section>
        <section className="card">
          <h2>查看示例</h2>
          <p>
            合成的“批量导出”案例：三方需求、三份资料、相互冲突的规则和预置的分析条目。不需要模型密钥。
          </p>
          {example ? (
            <p>
              <Link href={`/p/${example.id}`} className="btn btn-secondary">
                打开示例
              </Link>
            </p>
          ) : (
            <Form action={loadExampleAction} submit="载入示例" tone="secondary" fields={[]} />
          )}
        </section>
      </div>
    </>
  );
}
