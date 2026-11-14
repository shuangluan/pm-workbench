import { findTranscript, getAnalysis, getModelConfig, getProduct, getSource, getVersionWithEvidence, listRuns, sourceDeletionPreview } from "@pew/db";
import Link from "next/link";
import { addEvidenceAction, addSourceVersionAction, deleteSourceAction, saveTranscriptAction, startTranscribeAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { RunWatcher } from "@/components/RunWatcher";
import { SelectToCite } from "@/components/SelectToCite";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { fmtDate, plural, VALIDITY } from "@/lib/labels";

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
        <Tag key={a} data-start={a} title={cover.length ? plural(cover.length, "citation") : undefined}>
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
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={base}>{product.name}</Link>
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
        {isImage ? <span className="tag">Screenshot</span> : null}
        {source.kind === "transcript" ? <span className="tag">Transcript</span> : null}
      </h1>
      <p className="muted">
        v{version.version} · {VALIDITY[version.validity]} ·{" "}
        {isImage ? `${((version.byteSize ?? 0) / 1024).toFixed(0)} KB` : plural(version.charCount, "character")} · {fmtDate(version.createdAt)}
        {source.originalUrl ? <> · original link (never fetched): <code>{source.originalUrl}</code></> : null}
      </p>
      {version.validity === "needs_review" ? (
        <p className="banner banner-warn">
          This is an older version. Claims citing it are marked for review, and saved reports still point here. <Link href={`${base}/sources/${sourceId}?${keep}`}>See the current version v{latest.version}</Link>
        </p>
      ) : null}
      {deleted ? <p className="banner banner-danger">This source was permanently deleted. Its text and quoted sentences are no longer kept.</p> : null}
      {origin ? (
        <p className="banner banner-info">
          Transcribed from a screenshot {version.transcribedBy === "model" ? "by a model" : "by a user"} and may contain errors. Citations point at this text, not at the screenshot itself.
          {origin.sourceId ? <Link href={`${base}/sources/${origin.sourceId}?${keep}`}> See the original screenshot</Link> : null}
        </p>
      ) : null}
      {analysis && !isImage && version.validity === "valid" ? (
        <p className="banner banner-info">Select text in the source to cite it, or to add a claim based on it.</p>
      ) : null}

      <div className="viewer">
        {isImage ? (
          <section className="image-view" aria-label="Original screenshot">
            {deleted ? (
              <p className="empty">[screenshot deleted]</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${base}/files/${version.id}`} alt={`Screenshot: ${source.name}`} />
            )}
          </section>
        ) : (
          <section className="source-text" aria-label="Source text">
            {version.text === null ? (
              <p className="empty">[source deleted]</p>
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
              <h2>Transcript</h2>
              <p className="help">Once transcribed, you can select citations and split it into requests. Model transcripts can be wrong, so compare with the image.</p>
              {analysis ? <RunWatcher url={`${base}/a/${analysis.id}/runs`} active={reading.map((r) => `${r.id}:${r.status}`).join()} /> : null}
              {reading.length ? <p className="banner banner-info">The model is reading the screenshot…</p> : null}
              {!transcript && !reading.length && model?.hasKey && analysis ? (
                <Form
                  action={startTranscribeAction}
                  submit="Read with model"
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
                  <Link href="/settings#model">Configure a model</Link> to read it automatically, or transcribe it by hand.
                </p>
              ) : null}
              {!transcript && model?.hasKey && !analysis ? <p className="help">Open this screenshot from an analysis to read it with a model.</p> : null}
              {transcript ? (
                <p>
                  <Link href={`${base}/sources/${transcript.sourceId}?${keep}`}>See transcript v{transcript.version}</Link>
                  {" · "}
                  <Link href={`${base}/requests/new?from=${transcript.versionId}${analysis ? `&analysis=${analysis.id}` : ""}`}>Split the transcript into requests</Link>
                </p>
              ) : null}
              <Form
                action={saveTranscriptAction}
                submit={transcript ? "Save as new version" : "Save transcript"}
                tone="secondary"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "imageVersionId", type: "hidden", defaultValue: version.id },
                  { name: "analysisId", type: "hidden", defaultValue: analysis?.id ?? "" },
                  {
                    name: "text",
                    label: "Transcribe by hand",
                    type: "textarea",
                    rows: 8,
                    required: true,
                    defaultValue: transcript?.text ?? "",
                    placeholder: "Dana (Ops): Can we export the filtered results?\nLee (Sales): We need the whole team's customers",
                  },
                ]}
              />
            </>
          ) : (
            <>
              <h2>Citations ({evidences.length})</h2>
              {evidences.length ? (
                <ol className="evidence-list">
                  {evidences.map((e) => (
                    <li key={e.id}>
                      <a href={`#ev-${e.id}`}>
                        L{e.lineStart}
                        {e.lineEnd !== e.lineStart ? `–${e.lineEnd}` : ""}
                      </a>{" "}
                      <span className="quote">{e.quote ?? "[deleted]"}</span>
                      <span className="muted"> · cited by {plural(e.claimCount, "claim")}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">No citations in this version yet. Select text on the left to add one.</p>
              )}
              {version.validity === "valid" ? (
                <details className="disclosure">
                  <summary>Cite by pasting a sentence</summary>
                  <Form
                    action={addEvidenceAction}
                    submit="Add citation"
                    tone="secondary"
                    fields={[
                      { name: "productId", type: "hidden", defaultValue: productId },
                      { name: "versionId", type: "hidden", defaultValue: version.id },
                      { name: "quote", label: "Sentence copied from the source", type: "textarea", rows: 3, required: true, help: "Must match the source exactly. If it appears more than once, copy a few more characters." },
                    ]}
                  />
                </details>
              ) : null}
            </>
          )}

          <h2>Versions</h2>
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
              <summary>{source.kind === "transcript" ? "Edit transcript (saved as a new version)" : "Upload a new version"}</summary>
              <p className="help">A new version does not overwrite the old one. Citations of the old version stay, and the claims using them are marked for review.</p>
              <Form
                action={addSourceVersionAction}
                submit="Save as new version"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "sourceId", type: "hidden", defaultValue: sourceId },
                  { name: "text", label: "Full text", type: "textarea", rows: 14, mono: true, required: true, defaultValue: latest.text ?? "" },
                ]}
              />
            </details>
          ) : null}
          <details className="disclosure danger-zone">
            <summary>Delete permanently</summary>
            <p>
              {isImage ? "The screenshot file and any text transcribed from it are deleted. " : ""}This deletes the content of {plural(preview.versions, "version")} and {plural(preview.evidences, "quoted sentence")}. {plural(preview.claims, "claim")} will be marked as source deleted, and quotes in {plural(preview.reports, "saved report")} are replaced with a placeholder. Files you exported and old backups are not affected; restoring an old backup can bring deleted content back.
            </p>
            <Form
              action={deleteSourceAction}
              submit="Delete source permanently"
              tone="danger"
              fields={[
                { name: "productId", type: "hidden", defaultValue: productId },
                { name: "sourceId", type: "hidden", defaultValue: sourceId },
                { name: "confirm", label: "Type DELETE to confirm", type: "text", required: true },
              ]}
            />
          </details>
        </>
      ) : null}
    </>
  );
}
