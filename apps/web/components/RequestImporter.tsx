"use client";

import { parseCsv, splitRequests, splitTable, type SplitMode } from "@pew/core/split";
import { useEffect, useId, useRef, useState } from "react";

export type ModelSplitResult = { requests: { party: string; title: string; text: string }[]; questions: string[] } | { error: string };

export interface RequestRow {
  key: string;
  party: string;
  title: string;
  text: string;
}

const MODE_LABEL: Record<SplitMode, string> = {
  table: "a table",
  speaker: "speakers or parties",
  list: "a numbered or bulleted list",
  paragraph: "paragraphs",
};

const PLACEHOLDER = `Paste any of these:
· a table copied from Excel or a sheet (a header row helps)
· a chat log: "Dana 10:02" with the message on the next line
· one "Party: request" per line
· a numbered list, or paragraphs separated by blank lines`;

let seq = 0;
const key = () => `r${++seq}`;

export function RequestImporter({
  rows,
  onChange,
  initialText = "",
  modelSplit,
}: {
  rows: RequestRow[];
  onChange: (rows: RequestRow[]) => void;
  initialText?: string;
  /** Present when a model is configured and an analysis is open. */
  modelSplit?: (text: string) => Promise<ModelSplitResult>;
}) {
  const uid = useId();
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [defaultParty, setDefaultParty] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);

  const runModelSplit = async () => {
    if (!modelSplit || !text.trim()) return;
    if (rows.length && !window.confirm("Replace the edited preview below with the model's result?")) return;
    setSplitting(true);
    setModelError(null);
    const r = await modelSplit(text);
    setSplitting(false);
    if ("error" in r) return setModelError(r.error);
    setMode("the model (please check)");
    setTruncated(false);
    setQuestions(r.questions);
    onChange(r.requests.map((c) => ({ key: key(), party: c.party, title: c.title, text: c.text })));
  };

  const apply = (result: ReturnType<typeof splitRequests>, label: string) => {
    if (rows.length && !window.confirm("Replace the edited preview below with the new split?")) return;
    setMode(label);
    setTruncated(result.truncated);
    onChange(result.candidates.map((c) => ({ key: key(), party: c.party ?? "", title: c.title ?? "", text: c.text })));
  };

  const split = (value = text) => {
    if (!value.trim()) return;
    const r = splitRequests(value);
    apply(r, MODE_LABEL[r.mode]);
  };

  const readCsv = async (file: File) => {
    const raw = await file.text();
    apply(splitTable(parseCsv(raw)), `CSV file "${file.name}"`);
  };

  // Text handed over from elsewhere (e.g. a screenshot transcript) is split right away.
  const autoSplit = useRef(!!initialText.trim());
  useEffect(() => {
    if (autoSplit.current) {
      autoSplit.current = false;
      const r = splitRequests(initialText);
      setMode(MODE_LABEL[r.mode]);
      setTruncated(r.truncated);
      onChange(r.candidates.map((c) => ({ key: key(), party: c.party ?? "", title: c.title ?? "", text: c.text })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (k: string, patch: Partial<RequestRow>) => onChange(rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const missing = rows.filter((r) => !r.party.trim()).length;

  return (
    <div className="importer">
      <div className="field">
        <label htmlFor={`${uid}-paste`} className="label">
          Paste requests
        </label>
        <textarea
          id={`${uid}-paste`}
          rows={7}
          value={text}
          placeholder={PLACEHOLDER}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text/plain");
            if (pasted && !text.trim() && !rows.length) setTimeout(() => split(pasted), 0);
          }}
        />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={() => split()} disabled={!text.trim()}>
          Split
        </button>
        {modelSplit ? (
          <button type="button" className="btn btn-secondary" onClick={() => void runModelSplit()} disabled={!text.trim() || splitting}>
            {splitting ? "Splitting with model…" : "Split with model"}
          </button>
        ) : null}
        <label className="btn btn-secondary file-btn">
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readCsv(f);
              e.target.value = "";
            }}
          />
        </label>
        <span className="help">You can paste straight from Excel; no need to save as CSV.</span>
      </div>
      {modelError ? <p className="error">{modelError}</p> : null}

      {rows.length || mode ? (
        <section className="preview" aria-label="Split preview">
          <p className="preview-head">
            <strong>Preview: {rows.length === 1 ? "1 request" : `${rows.length} requests`}</strong>
            {mode ? <span className="muted"> · split as {mode}</span> : null}
            {truncated ? <span className="warn"> · only the first 50 were kept; import the rest separately</span> : null}
          </p>
          <p className="help">The original text is saved exactly as written. Check the split, and edit, remove or add requests as needed.</p>
          {missing ? (
            <div className="form-actions">
              <span className="warn">{missing === 1 ? "1 request has" : `${missing} requests have`} no party.</span>
              <input
                type="text"
                aria-label="Party for all empty rows"
                placeholder="Fill in as…"
                value={defaultParty}
                onChange={(e) => setDefaultParty(e.target.value)}
                className="inline-input"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!defaultParty.trim()}
                onClick={() => onChange(rows.map((r) => (r.party.trim() ? r : { ...r, party: defaultParty.trim() })))}
              >
                Fill empty rows
              </button>
            </div>
          ) : null}
          <ol className="rows">
            {rows.map((r, i) => (
              <li key={r.key} className={r.party.trim() ? "row" : "row row-missing"}>
                <div className="row-meta">
                  <input aria-label={`Party of request ${i + 1}`} placeholder="Party" value={r.party} onChange={(e) => update(r.key, { party: e.target.value })} />
                  <input aria-label={`Title of request ${i + 1}`} placeholder="Title (optional)" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} />
                  <button type="button" className="linklike danger" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={`Remove request ${i + 1}`}>
                    Remove
                  </button>
                </div>
                <textarea aria-label={`Original text of request ${i + 1}`} rows={Math.min(6, Math.max(2, r.text.split("\n").length))} value={r.text} onChange={(e) => update(r.key, { text: e.target.value })} />
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { key: key(), party: defaultParty, title: "", text: "" }])}>
            Add a request
          </button>
          {questions.length ? (
            <div className="section">
              <p className="label">Questions you could ask (copy and send them yourself):</p>
              <ul className="list compact">
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function rowsToPayload(rows: RequestRow[]) {
  return rows
    .filter((r) => r.text.trim())
    .map((r) => ({ party: r.party.trim(), title: r.title.trim(), text: r.text }));
}
