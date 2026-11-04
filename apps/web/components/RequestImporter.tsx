"use client";

import { parseCsv, splitRequests, splitTable, type SplitMode } from "@pew/core/split";
import { useEffect, useId, useRef, useState } from "react";

export interface RequestRow {
  key: string;
  party: string;
  title: string;
  text: string;
}

const MODE_LABEL: Record<SplitMode, string> = {
  table: "表格",
  speaker: "按发言人 / 业务方",
  list: "编号或项目符号列表",
  paragraph: "按空行分段",
};

const PLACEHOLDER = `支持以下任意一种，直接粘贴即可：
· 从 Excel / 飞书表格复制的整块表格（含表头更准）
· 聊天记录：“王运营 10:02”下一行是消息
· 每行“业务方：原话”
· 编号列表，或用空行分隔的段落`;

let seq = 0;
const key = () => `r${++seq}`;

export function RequestImporter({
  rows,
  onChange,
  initialText = "",
}: {
  rows: RequestRow[];
  onChange: (rows: RequestRow[]) => void;
  initialText?: string;
}) {
  const uid = useId();
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [defaultParty, setDefaultParty] = useState("");

  const apply = (result: ReturnType<typeof splitRequests>, label: string) => {
    if (rows.length && !window.confirm("用新的识别结果替换下方已编辑的预览？")) return;
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
    apply(splitTable(parseCsv(raw)), `CSV 文件“${file.name}”`);
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
          粘贴需求
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
          识别拆分
        </button>
        <label className="btn btn-secondary file-btn">
          上传 CSV
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
        <span className="help">Excel 表格可以直接复制粘贴，不必另存为 CSV。</span>
      </div>

      {rows.length || mode ? (
        <section className="preview" aria-label="拆分预览">
          <p className="preview-head">
            <strong>预览：{rows.length} 条需求</strong>
            {mode ? <span className="muted"> · 识别为{mode}</span> : null}
            {truncated ? <span className="warn"> · 只保留了前 50 条，请分批导入</span> : null}
          </p>
          <p className="help">原话会原样保存；请检查拆分是否合理，可以直接修改、删除或补充。</p>
          {missing ? (
            <div className="form-actions">
              <span className="warn">{missing} 条缺少业务方。</span>
              <input
                type="text"
                aria-label="统一填写业务方"
                placeholder="统一填写为…"
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
                填入空缺
              </button>
            </div>
          ) : null}
          <ol className="rows">
            {rows.map((r, i) => (
              <li key={r.key} className={r.party.trim() ? "row" : "row row-missing"}>
                <div className="row-meta">
                  <input aria-label={`第 ${i + 1} 条的业务方`} placeholder="业务方" value={r.party} onChange={(e) => update(r.key, { party: e.target.value })} />
                  <input aria-label={`第 ${i + 1} 条的标题`} placeholder="标题（可选）" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} />
                  <button type="button" className="linklike danger" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={`删除第 ${i + 1} 条`}>
                    删除
                  </button>
                </div>
                <textarea aria-label={`第 ${i + 1} 条的原话`} rows={Math.min(6, Math.max(2, r.text.split("\n").length))} value={r.text} onChange={(e) => update(r.key, { text: e.target.value })} />
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { key: key(), party: defaultParty, title: "", text: "" }])}>
            添加一条
          </button>
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
