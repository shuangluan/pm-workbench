import { getProduct, listAnalyses, listRequests, listSources, productDeletionPreview } from "@pew/db";
import Link from "next/link";
import { createAnalysisAction, deleteProductAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { ANALYSIS_STATUS, fmtDate, VALIDITY } from "@/lib/labels";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const [analyses, sources, requests, preview] = await Promise.all([
    listAnalyses(db, productId),
    listSources(db, productId),
    listRequests(db, productId),
    productDeletionPreview(db, productId),
  ]);
  const base = `/p/${productId}`;

  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <span>{product.name}</span>
      </nav>
      <h1>
        {product.name}
        {product.isExample ? <span className="tag tag-example">示例</span> : null}
      </h1>
      {product.description ? <p className="muted">{product.description}</p> : null}

      <section className="section" id="analyses">
        <div className="section-head">
          <h2>分析任务</h2>
          <Link href={`/start?product=${productId}`} className="btn btn-primary">
            快速开始一次分析
          </Link>
        </div>
        {analyses.length ? (
          <ul className="list">
            {analyses.map((a) => (
              <li key={a.id}>
                <Link href={`${base}/a/${a.id}`}>{a.title}</Link>
                <span className={`tag tag-${a.status}`}>{ANALYSIS_STATUS[a.status]}</span>
                <span className="muted"> · 更新 {fmtDate(a.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">还没有分析任务。</p>
        )}
        <details className="disclosure">
          <summary>新建分析</summary>
          <Form
            action={createAnalysisAction}
            submit="创建分析"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "title", label: "标题", type: "text", required: true, placeholder: "例如：统一批量导出能力" },
              { name: "goal", label: "本次目标", type: "textarea", rows: 2 },
              { name: "changeDescription", label: "改动描述（做影响检查时填写）", type: "textarea", rows: 2 },
            ]}
          />
        </details>
      </section>

      <section className="section" id="requests">
        <div className="section-head">
          <h2>需求</h2>
          <Link href={`${base}/requests/new`} className="btn btn-secondary">
            录入需求
          </Link>
        </div>
        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">业务方</th>
                  <th scope="col">标题</th>
                  <th scope="col">原话</th>
                  <th scope="col">版本</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.party}</td>
                    <td>
                      <Link href={`${base}/requests/${r.id}`}>{(r.fields as Record<string, string>).title || "（未命名）"}</Link>
                    </td>
                    <td className="clip">{r.originalText ?? "［来源已删除］"}</td>
                    <td>v{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">还没有需求。</p>
        )}
      </section>

      <section className="section" id="sources">
        <div className="section-head">
          <h2>资料</h2>
          <Link href={`${base}/sources/new`} className="btn btn-secondary">
            添加资料
          </Link>
        </div>
        {sources.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">当前版本</th>
                  <th scope="col">状态</th>
                  <th scope="col">大小</th>
                  <th scope="col">更新</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`${base}/sources/${s.id}`}>{s.name}</Link>
                      {s.kind === "image" ? <span className="tag">截图</span> : s.kind === "transcript" ? <span className="tag">转写</span> : null}
                    </td>
                    <td>v{s.version}{s.versionCount > 1 ? <span className="muted">（共 {s.versionCount} 版）</span> : null}</td>
                    <td>{VALIDITY[s.validity]}</td>
                    <td>{s.kind === "image" ? `${Math.ceil((s.byteSize ?? 0) / 1024)} KB` : `${s.charCount.toLocaleString()} 字符`}</td>
                    <td>{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">还没有资料。资料上传后不会自动调用 AI。</p>
        )}
      </section>

      <section className="section">
        <h2>数据</h2>
        <p>
          <a href={`${base}/export`} className="btn btn-secondary" download>
            导出产品（ZIP）
          </a>
          <span className="help"> 包含需求、资料原文、条目、报告和校验和；不含访问口令、会话或模型密钥。</span>
        </p>
        <details className="disclosure danger-zone">
          <summary>删除产品</summary>
          <p>
            将永久删除 {preview.analyses} 个分析、{preview.reports} 个报告版本、{preview.requests} 条需求、{preview.sources} 份资料。已导出的文件和旧备份不受影响。
          </p>
          <Form
            action={deleteProductAction}
            submit={product.isExample ? "清除示例" : "永久删除产品"}
            tone="danger"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              ...(product.isExample
                ? []
                : [{ name: "confirmName", label: `输入产品名“${product.name}”以确认`, type: "text" as const, required: true }]),
            ]}
          />
        </details>
      </section>
    </>
  );
}
