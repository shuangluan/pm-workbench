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
      <section className="hero">
        <div>
          <h1>把一堆需求整理成有依据的分析</h1>
          <p>粘贴聊天记录、表格或截图，加上相关规则文档，整理出每条结论都能追溯到原文的分析报告，并列出需要决策、补充和验证的事项。所有内容只保存在本机。</p>
        </div>
        <div className="hero-actions">
          <Link href="/start" className="btn btn-primary btn-large">
            快速开始一次分析
          </Link>
          {example ? (
            <Link href={`/p/${example.id}`} className="btn btn-secondary">
              看看示例结果
            </Link>
          ) : (
            <Form action={loadExampleAction} submit="先看示例结果" tone="secondary" fields={[]} />
          )}
        </div>
      </section>

      <h2>产品</h2>
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
        <p className="empty">还没有产品。点“快速开始”时可以顺便新建。</p>
      )}

      <details className="disclosure">
        <summary>只创建一个空产品</summary>
        <section className="card">
          <Form
            action={createProductAction}
            submit="创建"
            fields={[
              { name: "name", label: "产品名称", type: "text", required: true, maxLength: 120, placeholder: "例如：客户管理平台" },
              { name: "description", label: "说明", type: "textarea", rows: 2 },
            ]}
          />
        </section>
      </details>
    </>
  );
}
