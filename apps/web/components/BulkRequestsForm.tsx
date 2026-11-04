"use client";

import { startTransition, useActionState, useState } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";
import { startSplitAction } from "@/app/actions";
import { RequestImporter, rowsToPayload, type ModelSplitResult, type RequestRow } from "./RequestImporter";

interface RunStatus {
  id: string;
  status: string;
  errorMessage: string | null;
  output: { requests: { party: string; title: string; text: string }[]; questions: string[] } | null;
}

export function BulkRequestsForm({
  action,
  productId,
  analysisId,
  batchKey,
  initialText,
  sourceName,
  modelReady = false,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  productId: string;
  analysisId?: string;
  batchKey: string;
  initialText?: string;
  sourceName?: string;
  modelReady?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const payload = rowsToPayload(rows);

  // The split runs as a background task; poll until it finishes.
  const modelSplit = async (text: string): Promise<ModelSplitResult> => {
    const started = await startSplitAction({ productId, analysisId: analysisId!, text, key: crypto.randomUUID() });
    if (!started.runId) return { error: started.error ?? "无法开始拆分" };
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 1500));
      const res = await fetch(`/p/${productId}/a/${analysisId}/runs`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) continue;
      const run = ((await res.json()) as RunStatus[]).find((r) => r.id === started.runId);
      if (!run || run.status === "queued" || run.status === "running") continue;
      if (run.status === "succeeded" && run.output) return run.output;
      return { error: run.errorMessage ?? "拆分没有完成，可以用“识别拆分”" };
    }
  };

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
      <RequestImporter rows={rows} onChange={setRows} initialText={initialText} modelSplit={modelReady && analysisId ? modelSplit : undefined} />
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
