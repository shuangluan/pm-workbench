"use client";

import { useActionState, useId } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export interface Field {
  name: string;
  label?: string;
  type: "text" | "password" | "textarea" | "select" | "hidden" | "checkboxes" | "file" | "number";
  defaultValue?: string | string[];
  options?: Option[];
  required?: boolean;
  rows?: number;
  help?: string;
  placeholder?: string;
  multiple?: boolean;
  accept?: string;
  maxLength?: number;
  autoComplete?: string;
  mono?: boolean;
}

type Action = (state: FormState, data: FormData) => Promise<FormState>;

export function Form({
  action,
  fields,
  submit,
  tone = "primary",
  inline = false,
  confirm,
}: {
  action: Action;
  fields: Field[];
  submit: string;
  tone?: "primary" | "secondary" | "danger";
  inline?: boolean;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  // Many forms share a page (one per claim), so ids must be unique per form.
  const uid = useId();
  const value = (f: Field) => state.values?.[f.name] ?? f.defaultValue;

  return (
    <form
      key={state.seq}
      action={formAction}
      className={inline ? "form form-inline" : "form"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const v = value(f);
        if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} value={String(f.defaultValue ?? "")} />;
        const label = f.label ? (
          <label htmlFor={f.type === "checkboxes" ? undefined : id} className="label">
            {f.label}
            {f.required ? <span aria-hidden="true"> *</span> : null}
          </label>
        ) : null;
        let control: React.ReactNode;
        if (f.type === "textarea") {
          control = (
            <textarea
              id={id}
              name={f.name}
              rows={f.rows ?? 6}
              defaultValue={typeof v === "string" ? v : ""}
              required={f.required}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              className={f.mono ? "mono" : undefined}
            />
          );
        } else if (f.type === "select") {
          control = (
            <select id={id} name={f.name} defaultValue={typeof v === "string" ? v : undefined} required={f.required}>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        } else if (f.type === "checkboxes") {
          const checked = new Set(Array.isArray(v) ? v : v ? [v] : []);
          control = (
            <fieldset className="checks" aria-label={f.label}>
              {f.options?.length ? null : <p className="muted">（无可选项）</p>}
              {f.options?.map((o) => (
                <label key={o.value} className="check">
                  <input type="checkbox" name={f.name} value={o.value} defaultChecked={checked.has(o.value)} />
                  <span>
                    {o.label}
                    {o.hint ? <span className="muted"> · {o.hint}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          );
        } else if (f.type === "file") {
          control = <input id={id} type="file" name={f.name} multiple={f.multiple} accept={f.accept} required={f.required} />;
        } else {
          control = (
            <input
              id={id}
              type={f.type}
              name={f.name}
              defaultValue={typeof v === "string" ? v : ""}
              required={f.required}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              autoComplete={f.autoComplete}
            />
          );
        }
        return (
          <div key={f.name} className="field">
            {label}
            {control}
            {f.help ? <p className="help">{f.help}</p> : null}
          </div>
        );
      })}
      <div className="form-actions">
        <button type="submit" className={`btn btn-${tone}`} disabled={pending}>
          {pending ? "处理中…" : submit}
        </button>
        <span role="status" aria-live="polite">
          {state.error ? <span className="error">{state.error}</span> : state.ok ? <span className="ok">{state.ok}</span> : null}
        </span>
      </div>
    </form>
  );
}
