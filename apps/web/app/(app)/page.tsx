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
          <h1>Turn scattered requests into an evidence-based analysis</h1>
          <p>Paste chat logs, tables or screenshots plus the relevant rules, and get a report where every claim traces back to the original text, along with the decisions, missing material and checks still needed. Everything stays on this machine.</p>
        </div>
        <div className="hero-actions">
          <Link href="/start" className="btn btn-primary btn-large">
            Quick start an analysis
          </Link>
          {example ? (
            <Link href={`/p/${example.id}`} className="btn btn-secondary">
              See the example
            </Link>
          ) : (
            <Form action={loadExampleAction} submit="See the example first" tone="secondary" fields={[]} />
          )}
        </div>
      </section>

      <h2>Products</h2>
      <p className="muted">Each product has its own sources, requests, memory and analyses. Products never reference each other.</p>

      {products.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Analyses</th>
                <th scope="col">Sources</th>
                <th scope="col">Last analysis</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/p/${p.id}`}>{p.name}</Link>
                    {p.isExample ? <span className="tag tag-example">Example</span> : null}
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
        <p className="empty">No products yet. Quick start can create one for you.</p>
      )}

      <details className="disclosure">
        <summary>Just create an empty product</summary>
        <section className="card">
          <Form
            action={createProductAction}
            submit="Create"
            fields={[
              { name: "name", label: "Product name", type: "text", required: true, maxLength: 120, placeholder: "e.g. Customer platform" },
              { name: "description", label: "Description", type: "textarea", rows: 2 },
            ]}
          />
        </section>
      </details>
    </>
  );
}
