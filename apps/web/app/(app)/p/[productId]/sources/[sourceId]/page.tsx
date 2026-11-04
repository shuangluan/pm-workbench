import { findTranscript, getAnalysis, getModelConfig, getProduct, getSource, getVersionWithEvidence, listRuns, sourceDeletionPreview } from "@pew/db";
import Link from "next/link";
import { addEvidenceAction, addSourceVersionAction, deleteSourceAction, saveTranscriptAction, startTranscribeAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { RunWatcher } from "@/components/RunWatcher";
import { SelectToCite } from "@/components/SelectToCite";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { fmtDate, VALIDITY } from "@/lib/labels";

interface Span {
  id: string;
  start: number;
  end: number;
}

/**
 * Split each line at citation boundaries so highlights can overlap and cross
 * lines. Every piece carries data-start, which select-to-cite maps back to offsets.
 */
function renderLines(text: string, spans: Span[]) {
  const lines: React.ReactNode[] = [];
  let offset = 0;
  text.split("\n").forEach((line, i) => {
    const ls = offset;
    const le = offset + line.length;
    const hits = spans.filter((s) => s.start < le && s.end > ls);
    const cuts = [...new Set([ls, le, ...hits.flatMap((s) => [s.start, s.end]).filter((x) => x > ls && x < le)])].sort((a, b) => a - b);
    const parts: React.ReactNode[] = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      const cover = hits.filter((s) => s.start <= a && s.end >= b);
      const anchors = hits.filter((s) => s.start === a).map((s) => <span key={s.id} id={`ev-${s.id}`} className="anchor" />);
      const Tag = cover.length ? "mark" : "span";
      parts.push(
        <Tag key={a} data-start={a} title={cover.length ? `${cover.length} 条引用` : undefined}>
          {anchors}
          {text.slice(a, b)}
        </Tag>,
      );
    }
    lines.push(
      <div key={i} className="line" id={`L${i + 1}`}>
        <span className="ln" aria-hidden="true">
          {i + 1}
        </span>
        <span className="lt">{parts.length ? parts : "​"}</span>
      </div>,
    );
    offset = le + 1;
  });
  return lines;
}

export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string; sourceId: string }>;
  searchParams: Promise<{ v?: string; analysis?: string }>;
}) {
  const { productId, sourceId } = await params;
  const { v, analysis: analysisId } = await searchParams;
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const source = await found(getSource(db, productId, sourceId));
  const analysis = analysisId ? await found(getAnalysis(db, productId, analysisId)) : null;
  const current = source.versions.find((x) => x.id === v) ?? source.versions[0]!;
  const latest = source.versions[0]!;
  const { version, evidences } = await getVersionWithEvidence(db, productId, current.id);
  const preview = await sourceDeletionPreview(db, productId, sourceId);
  const base = `/p/${productId}`;
  const deleted = latest.validity === "source_deleted";
  const isImage = source.kind === "image";
  const transcript = isImage && !deleted ? await findTranscript(db, productId, version.id) : null;
  const origin = version.derivedFromVersionId
    ? (await getVersionWithEvidence(db, productId, version.derivedFromVersionId)).version
    : null;
  const keep = analysis ? `analysis=${analysis.id}` : "";
  const model = isImage ? await getModelConfig(db) : null;
  const runs = analysis && isImage ? await listRuns(db, productId, analysis.id) : [];
  const reading = runs.filter((r) => (r.status === "queued" || r.status === "running") && r.taskType === "transcribe_image");

  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={base}>{product.name}</Link>
        {analysis ? (
          <>
            {" "}
            / <Link href={`${base}/a/${analysis.id}?step=claims`}>{analysis.title}</Link>
          </>
        ) : null}{" "}
        / <span>{source.name}</span>
      </nav>
      <h1>
        {source.name}
        {isImage ? <span className="tag">截图</span> : null}
        {source.kind === "transcript" ? <span className="tag">转写</span> : null}
      </h1>
      <p className="muted">
        v{version.version} · {VALIDITY[version.validity]} ·{" "}
        {isImage ? `${((version.byteSize ?? 0) / 1024).toFixed(0)} KB` : `${version.charCount.toLocaleString()} 字符`} · {fmtDate(version.createdAt)}
        {source.originalUrl ? <> · 原始链接（未访问）：<code>{source.originalUrl}</code></> : null}
      </p>
      {version.validity === "needs_review" ? (
        <p className="banner banner-warn">
          这是旧版本。引用它的结论已标为“待复核”，历史报告仍指向此版本。<Link href={`${base}/sources/${sourceId}?${keep}`}>查看当前版本 v{latest.version}</Link>
        </p>
      ) : null}
      {deleted ? <p className="banner banner-danger">该资料已永久删除，原文和引用原句不再保留。</p> : null}
      {origin ? (
        <p className="banner banner-info">
          {version.transcribedBy === "model" ? "由模型" : "由用户"}从截图转写，可能有误；引用的是这段转写文字，不是截图本身。
          {origin.sourceId ? <Link href={`${base}/sources/${origin.sourceId}?${keep}`}> 查看原截图</Link> : null}
        </p>
      ) : null}
      {analysis && !isImage && version.validity === "valid" ? (
        <p className="banner banner-info">在原文中用鼠标选中一段文字，即可引用或直接以它为依据添加条目。</p>
      ) : null}

      <div className="viewer">
        {isImage ? (
          <section className="image-view" aria-label="截图原图">
            {deleted ? (
              <p className="empty">［截图已删除］</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${base}/files/${version.id}`} alt={`截图：${source.name}`} />
            )}
          </section>
        ) : (
          <section className="source-text" aria-label="原文">
            {version.text === null ? (
              <p className="empty">［来源已删除］</p>
            ) : version.validity === "valid" ? (
              <SelectToCite productId={productId} versionId={version.id} analysisId={analysis?.id}>
                {renderLines(version.text, evidences.map((e) => ({ id: e.id, start: e.charStart, end: e.charEnd })))}
              </SelectToCite>
            ) : (
              renderLines(version.text, evidences.map((e) => ({ id: e.id, start: e.charStart, end: e.charEnd })))
            )}
          </section>
        )}
        <aside className="side">
          {isImage && !deleted ? (
            <>
              <h2>转写</h2>
              <p className="help">转写后就能划选引用、拆分成需求。模型转写可能有误，请对照原图检查。</p>
              {analysis ? <RunWatcher url={`${base}/a/${analysis.id}/runs`} active={reading.map((r) => `${r.id}:${r.status}`).join()} /> : null}
              {reading.length ? <p className="banner banner-info">模型正在读取截图…</p> : null}
              {!transcript && !reading.length && model?.hasKey && analysis ? (
                <Form
                  action={startTranscribeAction}
                  submit="用模型读取截图"
                  fields={[
                    { name: "productId", type: "hidden", defaultValue: productId },
                    { name: "analysisId", type: "hidden", defaultValue: analysis.id },
                    { name: "imageVersionId", type: "hidden", defaultValue: version.id },
                    { name: "key", type: "hidden", defaultValue: crypto.randomUUID() },
                  ]}
                />
              ) : null}
              {!transcript && !model?.hasKey ? (
                <p className="help">
                  <Link href="/settings#model">配置模型</Link>后可以自动读取，否则请手动转写。
                </p>
              ) : null}
              {!transcript && model?.hasKey && !analysis ? <p className="help">从分析页打开这张截图，可以用模型读取。</p> : null}
              {transcript ? (
                <p>
                  <Link href={`${base}/sources/${transcript.sourceId}?${keep}`}>查看转写 v{transcript.version}</Link>
                  {" · "}
                  <Link href={`${base}/requests/new?from=${transcript.versionId}${analysis ? `&analysis=${analysis.id}` : ""}`}>从转写拆分需求</Link>
                </p>
              ) : null}
              <Form
                action={saveTranscriptAction}
                submit={transcript ? "保存为新版本" : "保存转写"}
                tone="secondary"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "imageVersionId", type: "hidden", defaultValue: version.id },
                  { name: "analysisId", type: "hidden", defaultValue: analysis?.id ?? "" },
                  {
                    name: "text",
                    label: "手动转写",
                    type: "textarea",
                    rows: 8,
                    required: true,
                    defaultValue: transcript?.text ?? "",
                    placeholder: "王运营：能不能导出筛选结果？\n李销售：我们要导出整个团队的客户",
                  },
                ]}
              />
            </>
          ) : (
            <>
              <h2>引用（{evidences.length}）</h2>
              {evidences.length ? (
                <ol className="evidence-list">
                  {evidences.map((e) => (
                    <li key={e.id}>
                      <a href={`#ev-${e.id}`}>
                        L{e.lineStart}
                        {e.lineEnd !== e.lineStart ? `–${e.lineEnd}` : ""}
                      </a>{" "}
                      <span className="quote">{e.quote ?? "［已删除］"}</span>
                      <span className="muted"> · 被 {e.claimCount} 条结论引用</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">这个版本还没有引用。选中左侧文字即可添加。</p>
              )}
              {version.validity === "valid" ? (
                <details className="disclosure">
                  <summary>粘贴原句添加引用</summary>
                  <Form
                    action={addEvidenceAction}
                    submit="添加引用"
                    tone="secondary"
                    fields={[
                      { name: "productId", type: "hidden", defaultValue: productId },
                      { name: "versionId", type: "hidden", defaultValue: version.id },
                      { name: "quote", label: "从原文复制一句", type: "textarea", rows: 3, required: true, help: "必须与原文完全一致；出现多次时请多复制几个字。" },
                    ]}
                  />
                </details>
              ) : null}
            </>
          )}

          <h2>版本</h2>
          <ul className="list compact">
            {source.versions.map((x) => (
              <li key={x.id}>
                <Link href={`${base}/sources/${sourceId}?v=${x.id}${keep ? `&${keep}` : ""}`} aria-current={x.id === version.id ? "page" : undefined}>
                  v{x.version}
                </Link>{" "}
                <span className="muted">
                  {VALIDITY[x.validity]} · {fmtDate(x.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {!deleted ? (
        <>
          {!isImage ? (
            <details className="disclosure">
              <summary>{source.kind === "transcript" ? "修改转写（保存为新版本）" : "上传新版本"}</summary>
              <p className="help">新版本不会覆盖旧版本。旧版本的引用保留，相关结论标为待复核。</p>
              <Form
                action={addSourceVersionAction}
                submit="保存为新版本"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "sourceId", type: "hidden", defaultValue: sourceId },
                  { name: "text", label: "全文", type: "textarea", rows: 14, mono: true, required: true, defaultValue: latest.text ?? "" },
                ]}
              />
            </details>
          ) : null}
          <details className="disclosure danger-zone">
            <summary>永久删除</summary>
            <p>
              {isImage ? "将删除截图文件及由它转写的文字。" : ""}将删除 {preview.versions} 个版本的内容和 {preview.evidences} 条引用原句。{preview.claims}{" "}
              条结论会标为“来源已删除”，{preview.reports} 个已保存报告中的原句会替换为占位符。已导出的文件和旧备份不受影响，恢复旧备份可能恢复已删内容。
            </p>
            <Form
              action={deleteSourceAction}
              submit="永久删除资料"
              tone="danger"
              fields={[
                { name: "productId", type: "hidden", defaultValue: productId },
                { name: "sourceId", type: "hidden", defaultValue: sourceId },
                { name: "confirm", label: "输入“永久删除”以确认", type: "text", required: true },
              ]}
            />
          </details>
        </>
      ) : null}
    </>
  );
}
