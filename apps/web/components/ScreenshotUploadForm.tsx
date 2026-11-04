"use client";

import { startTransition, useActionState, useState } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";
import { ScreenshotPicker } from "./ScreenshotPicker";

export function ScreenshotUploadForm({
  action,
  productId,
  analysisId,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  productId: string;
  analysisId?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const [files, setFiles] = useState<File[]>([]);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("productId", productId);
        if (analysisId) fd.set("analysisId", analysisId);
        files.forEach((f) => fd.append("images", f));
        startTransition(() => dispatch(fd));
        setFiles([]);
      }}
    >
      <ScreenshotPicker files={files} onChange={setFiles} />
      <div className="form-actions">
        <button type="submit" className="btn btn-secondary" disabled={!files.length || pending}>
          {pending ? "保存中…" : `保存 ${files.length} 张截图${analysisId ? "并加入本次分析" : ""}`}
        </button>
        <span role="status" aria-live="polite">
          {state.error ? <span className="error">{state.error}</span> : state.ok ? <span className="ok">{state.ok}</span> : null}
        </span>
      </div>
    </form>
  );
}
