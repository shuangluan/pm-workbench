"use client";

import { startTransition, useActionState, useState } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";
import { RequestImporter, rowsToPayload, type RequestRow } from "./RequestImporter";
import { ScreenshotPicker } from "./ScreenshotPicker";

type Action = (state: FormState, data: FormData) => Promise<FormState>;

export function QuickStartForm({
  action,
  products,
  defaultProductId,
  batchKey,
}: {
  action: Action;
  products: { id: string; name: string }[];
  defaultProductId?: string;
  batchKey: string;
}) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const [productId, setProductId] = useState(defaultProductId ?? (products.length ? "" : "new"));
  const [productName, setProductName] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");

  const payload = rowsToPayload(rows);
  const canSubmit = !!title.trim() && (payload.length > 0 || images.length > 0) && (productId === "new" ? !!productName.trim() : !!productId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("batchKey", batchKey);
    if (productId === "new") fd.set("productName", productName);
    else fd.set("productId", productId);
    fd.set("title", title);
    fd.set("goal", goal);
    fd.set("requests", JSON.stringify(payload));
    images.forEach((f) => fd.append("images", f));
    docs.forEach((f) => fd.append("docs", f));
    fd.set("docName", docName);
    fd.set("docText", docText);
    startTransition(() => dispatch(fd));
  };

  return (
    <form className="form quickstart" onSubmit={submit}>
      <section className="card">
        <h2>1 · 这次要分析什么</h2>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="qs-product">
              产品
            </label>
            <select id="qs-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.length ? <option value="">选择已有产品…</option> : null}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="new">＋ 新建产品</option>
            </select>
            {productId === "new" ? (
              <input aria-label="新产品名称" placeholder="新产品名称，例如：客户管理平台" value={productName} onChange={(e) => setProductName(e.target.value)} />
            ) : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="qs-title">
              分析标题 *
            </label>
            <input id="qs-title" placeholder="例如：统一批量导出能力" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input aria-label="本次目标" placeholder="本次目标（可选）：例如判断三方诉求能否合并" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>2 · 需求</h2>
        <p className="help">粘贴文字或表格，或者直接粘贴聊天截图。两者都可以有。</p>
        <RequestImporter rows={rows} onChange={setRows} />
        <h3>聊天截图</h3>
        <ScreenshotPicker files={images} onChange={setImages} />
      </section>

      <section className="card">
        <h2>3 · 相关资料（可选）</h2>
        <p className="help">权限规则、接口说明、现有流程等。UTF-8 的 .md / .txt，单个不超过 2 MB；也可以直接粘贴。资料不会被发送到任何地方。</p>
        <div className="field">
          <label className="label" htmlFor="qs-docs">
            上传文件
          </label>
          <input id="qs-docs" type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(e) => setDocs([...(e.target.files ?? [])])} />
        </div>
        <div className="field">
          <label className="label" htmlFor="qs-doc-text">
            或粘贴一份资料
          </label>
          <input aria-label="粘贴资料的名称" placeholder="名称，例如：权限规则说明" value={docName} onChange={(e) => setDocName(e.target.value)} />
          <textarea id="qs-doc-text" rows={5} className="mono" value={docText} onChange={(e) => setDocText(e.target.value)} />
        </div>
      </section>

      <div className="form-actions sticky-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit || pending}>
          {pending ? "创建中…" : `创建分析（${payload.length} 条需求${images.length ? ` · ${images.length} 张截图` : ""}${docs.length || docText.trim() ? " · 含资料" : ""}）`}
        </button>
        <span role="status" aria-live="polite">
          {state.error ? <span className="error">{state.error}</span> : !canSubmit ? <span className="muted">需要分析标题、产品，以及至少一条需求或一张截图。</span> : null}
        </span>
      </div>
    </form>
  );
}
