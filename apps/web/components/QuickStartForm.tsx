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
        <h2>1 · What are you analyzing</h2>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="qs-product">
              Product
            </label>
            <select id="qs-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.length ? <option value="">Choose a product…</option> : null}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="new">+ New product</option>
            </select>
            {productId === "new" ? (
              <input aria-label="New product name" placeholder="New product name, e.g. Customer platform" value={productName} onChange={(e) => setProductName(e.target.value)} />
            ) : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="qs-title">
              Analysis title *
            </label>
            <input id="qs-title" placeholder="e.g. Unified bulk export" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input aria-label="Goal" placeholder="Goal (optional), e.g. can three teams' requests become one feature" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>2 · Requests</h2>
        <p className="help">Paste text or a table, or paste chat screenshots directly. You can use both.</p>
        <RequestImporter rows={rows} onChange={setRows} />
        <h3>Chat screenshots</h3>
        <ScreenshotPicker files={images} onChange={setImages} />
      </section>

      <section className="card">
        <h2>3 · Related sources (optional)</h2>
        <p className="help">Permission rules, interface docs, current processes and so on. UTF-8 .md or .txt up to 2 MB each, or paste the text. Nothing is sent anywhere when you save.</p>
        <div className="field">
          <label className="label" htmlFor="qs-docs">
            Upload files
          </label>
          <input id="qs-docs" type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(e) => setDocs([...(e.target.files ?? [])])} />
        </div>
        <div className="field">
          <label className="label" htmlFor="qs-doc-text">
            Or paste a source
          </label>
          <input aria-label="Name of the pasted source" placeholder="Name, e.g. Permission rules" value={docName} onChange={(e) => setDocName(e.target.value)} />
          <textarea id="qs-doc-text" rows={5} className="mono" value={docText} onChange={(e) => setDocText(e.target.value)} />
        </div>
      </section>

      <div className="form-actions sticky-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit || pending}>
          {pending ? "Creating…" : `Create analysis (${payload.length === 1 ? "1 request" : `${payload.length} requests`}${images.length ? ` · ${images.length === 1 ? "1 screenshot" : `${images.length} screenshots`}` : ""}${docs.length || docText.trim() ? " · with sources" : ""})`}
        </button>
        <span role="status" aria-live="polite">
          {state.error ? <span className="error">{state.error}</span> : !canSubmit ? <span className="muted">Needs a title, a product, and at least one request or screenshot.</span> : null}
        </span>
      </div>
    </form>
  );
}
