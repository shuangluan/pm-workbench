"use client";

import { startTransition, useActionState, useState } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";
import { RequestImporter, rowsToPayload, type RequestRow } from "./RequestImporter";

export function BulkRequestsForm({
  action,
  productId,
  analysisId,
  batchKey,
  initialText,
  sourceName,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  productId: string;
  analysisId?: string;
  batchKey: string;
  initialText?: string;
  sourceName?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const payload = rowsToPayload(rows);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("productId", productId);
        if (analysisId) fd.set("analysisId", analysisId);
        fd.set("batchKey", batchKey);
        fd.set("sourceName", sourceName ?? "");
        fd.set("requests", JSON.stringify(payload));
        startTransition(() => dispatch(fd));
      }}
    >
      <RequestImporter rows={rows} onChange={setRows} initialText={initialText} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!payload.length || pending}>
          {pending ? "保存中…" : `保存 ${payload.length} 条需求${analysisId ? "并加入本次分析" : ""}`}
        </button>
        <span role="status" aria-live="polite">
          {state.error ? <span className="error">{state.error}</span> : null}
        </span>
      </div>
    </form>
  );
}
