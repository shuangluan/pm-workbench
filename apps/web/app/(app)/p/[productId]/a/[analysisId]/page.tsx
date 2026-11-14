import { nextSteps, openItems, reportStatus, type ClaimKind, type ClaimSection } from "@pew/core";
import {
  buildSnapshot,
  CLAIM_SECTIONS,
  getAnalysis,
  getProduct,
  listClaims,
  listEvidence,
  listReportVersions,
  listRequests,
  listSources,
  loadMemory,
  listRuns,
  previewAbstraction,
  runIsStale,
  type ClaimView,
} from "@pew/db";
import Link from "next/link";
import {
  addClaimAction,
  archiveAnalysisAction,
  cancelRunAction,
  deleteAnalysisAction,
  retryRunAction,
  reviewAction,
  saveReportAction,
  setChangeNodesAction,
  setScopeAction,
  startAbstractionAction,
  startTranscribeAction,
  updateAnalysisAction,
  uploadImagesAction,
} from "@/app/actions";
import { RunWatcher } from "@/components/RunWatcher";
import { ScreenshotUploadForm } from "@/components/ScreenshotUploadForm";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { FAILURE_HINT, RUN_STATUS, TASK_LABEL } from "@/lib/runs-ui";
import { ANALYSIS_STATUS, NODE_TYPE, plural, fmtDate, KIND, KIND_HELP, REJECT, REPORT_STATUS, REVIEW, SECTION, VALIDITY } from "@/lib/labels";

const STEPS = [
  { id: "scope", label: "1 · Requests and sources" },
  { id: "claims", label: "2 · Review claims" },
  { id: "report", label: "3 · Report" },
  { id: "settings", label: "Settings" },
] as const;
type Step = (typeof STEPS)[number]["id"];

type EvidenceInfo = Awaited<ReturnType<typeof listEvidence>>[number];

function ClaimCard({ claim, evidence, productId }: { claim: ClaimView; evidence: Map<string, EvidenceInfo>; productId: string }) {
  const hidden = [
    { name: "productId", type: "hidden" as const, defaultValue: productId },
    { name: "claimId", type: "hidden" as const, defaultValue: claim.id },
    { name: "revision", type: "hidden" as const, defaultValue: String(claim.revision) },
  ];
  return (
    <article className={`claim claim-${claim.review}`} aria-label={`${KIND[claim.kind]}: ${claim.text.slice(0, 40)}`}>
      <header className="claim-tags">
        <span className={`tag kind-${claim.kind}`}>{KIND[claim.kind]}</span>
        <span className="tag">{claim.origin === "user" ? "User input" : "AI generated"}</span>
        <span className={`tag review-${claim.review}`}>{REVIEW[claim.review]}</span>
        {claim.evidenceValidity !== "valid" ? <span className="tag tag-warn">{VALIDITY[claim.evidenceValidity]}</span> : null}
        {claim.rejectReason ? <span className="tag">Reason: {REJECT[claim.rejectReason]}</span> : null}
      </header>
      <p className="claim-text">{claim.text}</p>
      {claim.reasoning ? <p className="claim-meta">Reasoning: {claim.reasoning}</p> : null}
      {claim.missing ? <p className="claim-meta">Needed: {claim.missing}</p> : null}
      {claim.original ? (
        <p className="claim-meta">
          Original AI text ({KIND[claim.original.kind]}): <s>{claim.original.text}</s>
        </p>
      ) : null}
      {claim.rejectNote ? <p className="claim-meta">Note: {claim.rejectNote}</p> : null}
      {claim.evidenceIds.length ? (
        <ul className="citations">
          {claim.evidenceIds.map((id) => {
            const e = evidence.get(id);
            if (!e) return null;
            return (
              <li key={id}>
                <Link href={`/p/${productId}/sources/${e.sourceId}?v=${e.versionId}#ev-${id}`}>
                  {e.sourceName} v{e.version} L{e.lineStart}
                </Link>
                {e.validity !== "valid" ? <span className="tag tag-warn">{VALIDITY[e.validity]}</span> : null}
                <span className="quote">{e.quote ?? "[source deleted; quote no longer kept]"}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="claim-meta muted">No citations</p>
      )}
      <div className="claim-actions">
        {claim.review !== "accepted" ? (
          <Form action={reviewAction} submit="Accept" tone="secondary" inline fields={[...hidden, { name: "type", type: "hidden", defaultValue: "accept" }]} />
        ) : null}
        {claim.review !== "pending" ? (
          <Form action={reviewAction} submit="Back to pending" tone="secondary" inline fields={[...hidden, { name: "type", type: "hidden", defaultValue: "reopen" }]} />
        ) : null}
        <details className="disclosure inline-disclosure">
          <summary>Correct</summary>
          <Form
            action={reviewAction}
            submit="Save correction"
            fields={[...hidden, { name: "type", type: "hidden", defaultValue: "correct" }, { name: "text", label: "Corrected text", type: "textarea", rows: 3, required: true, defaultValue: claim.text }]}
          />
        </details>
        {claim.review !== "rejected" ? (
          <details className="disclosure inline-disclosure">
            <summary>Reject</summary>
            <Form
              action={reviewAction}
              submit="Mark rejected"
              tone="danger"
              fields={[
                ...hidden,
                { name: "type", type: "hidden", defaultValue: "reject" },
                { name: "reason", label: "Reason", type: "select", options: Object.entries(REJECT).map(([value, label]) => ({ value, label })) },
                { name: "note", label: "Note (required for Other)", type: "text" },
              ]}
            />
          </details>
        ) : null}
      </div>
    </article>
  );
}

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string; analysisId: string }>;
  searchParams: Promise<{ step?: string; created?: string; cite?: string }>;
}) {
  const { productId, analysisId } = await params;
  const { step: requested, created, cite } = await searchParams;
  const step: Step = STEPS.find((s) => s.id === requested)?.id ?? "scope";
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const analysis = await found(getAnalysis(db, productId, analysisId));
  const claims = await listClaims(db, productId, analysisId);
  const pending = claims.filter((c) => c.review === "pending").length;
  const memory = step === "settings" ? await loadMemory(db, productId) : null;
  const base = `/p/${productId}/a/${analysisId}`;
  const archived = analysis.status === "archived";

  const next =
    !analysis.requestIds.length && !analysis.selectedSources.length
      ? { step: "scope", text: "Choose the requests and sources for this analysis" }
      : pending
        ? { step: "claims", text: `Review ${plural(pending, "pending claim")}` }
        : claims.length
          ? { step: "report", text: "Save a report version and export it" }
          : { step: "claims", text: "Add claims" };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>{analysis.title}</span>
      </nav>
      <h1>{analysis.title}</h1>
      <div className="statusbar" role="status">
        <span className={`tag tag-${analysis.status}`}>{ANALYSIS_STATUS[analysis.status]}</span>
        <span>
          {plural(analysis.requestIds.length, "request")} · {plural(analysis.selectedSources.length, "source")} · {plural(claims.length, "claim")}
        </span>
        <span className={pending ? "warn" : undefined}>{pending} pending</span>
        {!archived ? (
          <span>
            Next: <Link href={`${base}?step=${next.step}`}>{next.text}</Link>
          </span>
        ) : null}
      </div>
      {analysis.goal ? <p>Goal: {analysis.goal}</p> : null}
      {analysis.changeDescription ? <p className="muted">Change: {analysis.changeDescription}</p> : null}
      {archived ? <p className="banner banner-warn">This analysis is archived and read-only. Unarchive it under Settings.</p> : null}
      {created ? (
        <p className="banner banner-info">
          Created {plural(analysis.requestIds.length, "request")} and {plural(analysis.selectedSources.length, "source")}, all included in this analysis. Next: let the model draft the analysis, or open a source and select text to add claims by hand.
        </p>
      ) : null}

      <nav className="tabs" aria-label="Analysis steps">
        {STEPS.map((s) => (
          <Link key={s.id} href={`${base}?step=${s.id}`} aria-current={s.id === step ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>

      {step === "scope" ? <ScopeStep productId={productId} analysis={analysis} /> : null}
      {step === "claims" ? <ClaimsStep productId={productId} analysis={analysis} claims={claims} archived={archived} cite={cite} /> : null}
      {step === "report" ? <ReportStep productId={productId} analysisId={analysisId} pending={pending} /> : null}
      {step === "settings" ? (
        <section className="section">
          <div className="grid-2">
            <section className="card">
              <h2>Details</h2>
              <Form
                action={updateAnalysisAction}
                submit="Save"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "analysisId", type: "hidden", defaultValue: analysisId },
                  { name: "revision", type: "hidden", defaultValue: String(analysis.revision) },
                  { name: "title", label: "Title", type: "text", required: true, defaultValue: analysis.title },
                  { name: "goal", label: "Goal", type: "textarea", rows: 2, defaultValue: analysis.goal },
                  { name: "changeDescription", label: "Change description", type: "textarea", rows: 2, defaultValue: analysis.changeDescription },
                ]}
              />
            </section>
            <section className="card">
              <h2>Impact check starting points</h2>
              {memory?.nodes.length ? (
                <>
                  <p className="help">
                    Choose the modules or data objects this change touches directly. The report follows confirmed relations to find what depends on them and lists questions to verify. Unconfirmed relations are not used.
                  </p>
                  <Form
                    action={setChangeNodesAction}
                    submit="Save starting points"
                    tone="secondary"
                    fields={[
                      { name: "productId", type: "hidden", defaultValue: productId },
                      { name: "analysisId", type: "hidden", defaultValue: analysisId },
                      {
                        name: "nodeIds",
                        label: "Changed objects",
                        type: "checkboxes",
                        defaultValue: analysis.changeNodeIds,
                        options: memory.nodes.map((n) => ({ value: n.id, label: n.name, hint: NODE_TYPE[n.type] })),
                      },
                    ]}
                  />
                </>
              ) : (
                <p className="help">This product has no confirmed modules or relations yet. Pages for building that memory come in a later version; you can try the impact check in the example product.</p>
              )}
            </section>
            <section className="card">
              <h2>Archive or delete</h2>
              <p className="help">Archiving keeps everything and makes it read-only. Deleting removes this analysis's claims and report versions; the product's requests and sources are kept.</p>
              <Form
                action={archiveAnalysisAction}
                submit={archived ? "Unarchive" : "Archive"}
                tone="secondary"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "analysisId", type: "hidden", defaultValue: analysisId },
                  { name: "to", type: "hidden", defaultValue: archived ? "draft" : "archived" },
                ]}
              />
              <details className="disclosure danger-zone">
                <summary>Delete analysis permanently</summary>
                <Form
                  action={deleteAnalysisAction}
                  submit="Delete permanently"
                  tone="danger"
                  fields={[
                    { name: "productId", type: "hidden", defaultValue: productId },
                    { name: "analysisId", type: "hidden", defaultValue: analysisId },
                    { name: "confirm", label: "Type DELETE to confirm", type: "text", required: true },
                  ]}
                />
              </details>
            </section>
          </div>
        </section>
      ) : null}
    </>
  );
}

type AnalysisData = Awaited<ReturnType<typeof getAnalysis>>;

async function ScopeStep({ productId, analysis }: { productId: string; analysis: AnalysisData }) {
  const db = await getDb();
  const [requests, sources] = await Promise.all([listRequests(db, productId), listSources(db, productId)]);
  const latestIds = new Set(sources.map((s) => s.versionId));
  const staleSelected = analysis.selectedSources.filter((s) => !latestIds.has(s.versionId));
  const totalChars = analysis.selectedSources.reduce((n, s) => n + s.charCount, 0);
  const base = `/p/${productId}`;
  const q = `analysis=${analysis.id}`;
  const kindLabel = (k: string) => (k === "image" ? "Screenshot" : k === "transcript" ? "Transcript" : "");

  return (
    <section className="section">
      <div className="grid-2">
        <section className="card">
          <h2>Add requests</h2>
          <p className="help">Paste a chat log, table or list. After you confirm the preview, the requests join this analysis.</p>
          <p>
            <Link className="btn btn-primary" href={`${base}/requests/new?${q}`}>
              Add requests in bulk
            </Link>
          </p>
        </section>
        <section className="card">
          <h2>Add chat screenshots</h2>
          <ScreenshotUploadForm action={uploadImagesAction} productId={productId} analysisId={analysis.id} />
        </section>
      </div>

      {analysis.selectedSources.length ? (
        <>
          <h2>Sources in this analysis</h2>
          <ul className="list">
            {analysis.selectedSources.map((s) => (
              <li key={s.versionId}>
                <Link href={`${base}/sources/${s.sourceId}?v=${s.versionId}&${q}`}>
                  {s.name} v{s.version}
                </Link>
                {kindLabel(s.kind) ? <span className="tag">{kindLabel(s.kind)}</span> : null}
                <span className="muted">
                  {" "}
                  · {s.kind === "image" ? "open to transcribe" : "open to select citations"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <details className="disclosure">
        <summary>Adjust scope (choose the requests and sources to use)</summary>
        <p className="help">Selected text sources: {plural(totalChars, "character")}. Saving does not change saved reports; the analysis goes back to draft.</p>
        {staleSelected.length ? (
          <p className="banner banner-warn">
            A newer version exists for {staleSelected.map((s) => `"${s.name}" v${s.version}`).join(", ")}. Keeping the old version keeps using its old text; select the new version to update.
          </p>
        ) : null}
        <Form
          action={setScopeAction}
          submit="Save scope"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "analysisId", type: "hidden", defaultValue: analysis.id },
            { name: "revision", type: "hidden", defaultValue: String(analysis.revision) },
            {
              name: "requestIds",
              label: "Requests",
              type: "checkboxes",
              defaultValue: analysis.requestIds,
              options: requests.map((r) => ({
                value: r.id,
                label: `${r.party}: ${(r.fields as Record<string, string>).title || (r.originalText ?? "").slice(0, 40)}`,
                hint: (r.originalText ?? "[source deleted]").slice(0, 80),
              })),
            },
            {
              name: "sourceVersionIds",
              label: "Sources (current versions)",
              type: "checkboxes",
              defaultValue: analysis.selectedSources.map((s) => s.versionId),
              options: [
                ...sources
                  .filter((s) => s.validity === "valid")
                  .map((s) => ({
                    value: s.versionId,
                    label: `${s.name} v${s.version}`,
                    hint: s.kind === "image" ? "screenshot" : `${plural(s.charCount, "character")}${s.kind === "transcript" ? " · transcript" : ""}`,
                  })),
                ...staleSelected.map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}`, hint: "older version" })),
              ],
            },
          ]}
        />
        <p className="help">
          Upload text sources such as rules or interface docs on the <Link href={`${base}/sources/new`}>Add sources</Link> page.
        </p>
      </details>
    </section>
  );
}

async function ClaimsStep({
  productId,
  analysis,
  claims,
  archived,
  cite,
}: {
  productId: string;
  analysis: AnalysisData;
  claims: ClaimView[];
  archived: boolean;
  cite?: string;
}) {
  const db = await getDb();
  const requests = await listRequests(db, productId, analysis.requestIds);
  const scopeVersionIds = [...analysis.selectedSources.map((s) => s.versionId)];
  const pickable = await listEvidence(db, productId, { versionIds: scopeVersionIds });
  const requestEvidence = await listEvidence(db, productId, { ids: requests.map((r) => r.originalEvidenceId) });
  const cited = await listEvidence(db, productId, { ids: [...new Set([...claims.flatMap((c) => c.evidenceIds), ...(cite ? [cite] : [])])] });
  const evidence = new Map([...cited, ...pickable, ...requestEvidence].map((e) => [e.id, e]));
  // A citation just made by selecting text is offered first and pre-checked.
  const citeOption = cite ? cited.find((e) => e.id === cite) : undefined;
  const options = [...(citeOption ? [citeOption] : []), ...[...requestEvidence, ...pickable].filter((e) => e.id !== cite)];
  const textSources = analysis.selectedSources.filter((s) => s.kind !== "image" && s.validity === "valid");
  const sections = [...new Set([...CLAIM_SECTIONS, ...claims.map((c) => c.section)])];

  const coverage = (await buildSnapshot(db, productId, analysis.id)).coverage;

  return (
    <section className="section">
      {!archived ? <AiPanel productId={productId} analysis={analysis} /> : null}
      {coverage.length ? (
        <div className="claim-group">
          <h2>Request coverage</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Party</th>
                  <th scope="col">Goal</th>
                  <th scope="col">Shared</th>
                  <th scope="col">Specific constraints</th>
                  <th scope="col">Handling</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((r) => (
                  <tr key={r.requestHandle}>
                    <td>{r.requestHandle}</td>
                    <td>{r.party}</td>
                    <td>{r.goal}</td>
                    <td>{r.shared}</td>
                    <td>{r.specific}</td>
                    <td>{HANDLING[r.handling]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {claims.length ? (
        sections.map((section) => {
          const list = claims.filter((c) => c.section === section);
          if (!list.length) return null;
          return (
            <div key={section} className="claim-group">
              <h2>
                {SECTION[section as ClaimSection]} <span className="muted">({list.length})</span>
              </h2>
              {list.map((c) => (
                <ClaimCard key={c.id} claim={c} evidence={evidence} productId={productId} />
              ))}
            </div>
          );
        })
      ) : (
        <p className="empty">No claims yet. Let the model draft them, or add them by hand.</p>
      )}

      {!archived ? (
        <details className="disclosure" id="add-claim" open={!claims.length || !!cite}>
          <summary>Add a claim (user input)</summary>
          <p className="help">
            Quickest way: open a source, <strong>select a sentence with your mouse</strong>, and click "Add a claim based on this".
            {textSources.length ? (
              <>
                {" "}
                Open:
                {textSources.map((s, i) => (
                  <span key={s.versionId}>
                    {i ? ", " : ""}
                    <Link href={`/p/${productId}/sources/${s.sourceId}?v=${s.versionId}&analysis=${analysis.id}`}>{s.name}</Link>
                  </span>
                ))}
              </>
            ) : null}
          </p>
          <Form
            action={addClaimAction}
            submit="Add claim"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "analysisId", type: "hidden", defaultValue: analysis.id },
              {
                name: "kind",
                label: "What is it",
                type: "select",
                options: (["source_fact", "inference", "suggestion", "unknown"] as ClaimKind[]).map((k) => ({ value: k, label: `${KIND[k]} — ${KIND_HELP[k]}` })),
              },
              { name: "text", label: "Text", type: "textarea", rows: 3, required: true },
              { name: "reasoning", label: "Reasoning", type: "textarea", rows: 2, required: true, showWhen: { field: "kind", in: ["inference", "suggestion"] } },
              { name: "missing", label: "What is missing, and who can confirm it", type: "textarea", rows: 2, required: true, showWhen: { field: "kind", in: ["unknown"] } },
              {
                name: "evidenceIds",
                label: "Based on",
                type: "checkboxes",
                defaultValue: cite ? [cite] : [],
                options: options.map((e) => ({
                  value: e.id,
                  label: (e.quote ?? "[deleted]").slice(0, 120),
                  hint: `${e.sourceKind === "request_text" ? "request text" : e.sourceName} v${e.version} L${e.lineStart}${e.id === cite ? " · just selected" : ""}`,
                })),
              },
              {
                name: "section",
                label: "Report section",
                type: "select",
                advanced: true,
                options: CLAIM_SECTIONS.map((s) => ({ value: s, label: SECTION[s] })),
              },
              {
                name: "newQuoteVersionId",
                label: "Or cite a pasted sentence from",
                type: "select",
                advanced: true,
                options: [{ value: "", label: "(none)" }, ...textSources.map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}` }))],
              },
              { name: "newQuote", label: "Sentence copied from the source", type: "textarea", rows: 2, advanced: true },
            ]}
          />
        </details>
      ) : null}
    </section>
  );
}

const HANDLING: Record<string, string> = { shared_capability: "Shared capability", configuration: "Configuration / extension", separate: "Handle separately", not_covered: "Not covered" };

async function AiPanel({ productId, analysis }: { productId: string; analysis: AnalysisData }) {
  const db = await getDb();
  const [preview, runs] = await Promise.all([previewAbstraction(db, productId, analysis.id), listRuns(db, productId, analysis.id)]);
  const base = [
    { name: "productId", type: "hidden" as const, defaultValue: productId },
    { name: "analysisId", type: "hidden" as const, defaultValue: analysis.id },
    { name: "key", type: "hidden" as const, defaultValue: crypto.randomUUID() },
  ];
  const active = runs.filter((r) => r.status === "queued" || r.status === "running");
  const latest = runs.find((r) => r.taskType === "abstraction");
  const lastGood = runs.find((r) => r.taskType === "abstraction" && r.status === "succeeded");
  const stale = lastGood ? runIsStale(lastGood.scope, analysis) : false;
  const failed = runs.filter((r) => ["failed", "interrupted"].includes(r.status)).slice(0, 1).filter((r) => !runs.some((x) => x.taskType === r.taskType && x.createdAt > r.createdAt));

  if (!preview.configured) {
    return (
      <section className="card ai-panel">
        <h2>Draft the analysis with a model</h2>
        <p>
          With a model configured, one click drafts the common problem, shared capability proposals, conflicts and unknowns, and can read chat screenshots. <Link href="/settings#model">Configure a model</Link>
        </p>
        <p className="help">Everything can also be done by hand without a model.</p>
      </section>
    );
  }

  return (
    <section className="card ai-panel">
      <RunWatcher url={`/p/${productId}/a/${analysis.id}/runs`} active={active.map((r) => `${r.id}:${r.status}`).join()} />
      <h2>Draft the analysis with a model</h2>
      {active.map((r) => (
        <div key={r.id} className="run-line" role="status">
          <span className="tag tag-pending_review">{RUN_STATUS[r.status]}</span>
          <span>{TASK_LABEL[r.taskType] ?? r.taskType}</span>
          <Form action={cancelRunAction} submit="Cancel" tone="secondary" inline fields={[{ name: "productId", type: "hidden", defaultValue: productId }, { name: "runId", type: "hidden", defaultValue: r.id }]} />
        </div>
      ))}
      {active.length ? <p className="help">You can keep working or close the page while it runs. Cancel stops the request where it can, but the provider may already have billed it.</p> : null}
      {failed.map((r) => {
        const risky = r.errorKind === "outcome_unknown" || r.errorKind === "interrupted";
        return (
          <div key={r.id} className="banner banner-danger">
            <p>
              {TASK_LABEL[r.taskType] ?? r.taskType} {RUN_STATUS[r.status]?.toLowerCase()}: {r.errorMessage}
            </p>
            {r.errorKind && FAILURE_HINT[r.errorKind] ? <p>{FAILURE_HINT[r.errorKind]}</p> : null}
            <Form
              action={retryRunAction}
              submit="Retry"
              tone="secondary"
              inline
              confirm={risky ? "The last outcome is unknown and the provider may already have billed it. Retrying may cost extra. Continue?" : undefined}
              fields={[
                { name: "productId", type: "hidden", defaultValue: productId },
                { name: "runId", type: "hidden", defaultValue: r.id },
                { name: "key", type: "hidden", defaultValue: crypto.randomUUID() },
              ]}
            />
          </div>
        );
      })}
      {stale ? <p className="banner banner-warn">The requests or sources changed since this result was generated. You can regenerate.</p> : null}
      {preview.untranscribed.length ? (
        <div className="section">
          <p>
            {plural(preview.untranscribed.length, "screenshot")} not transcribed yet and will <strong>not</strong> be part of the analysis. Reading sends the original images to {preview.host}.
          </p>
          <Form
            action={startTranscribeAction}
            submit={`Read ${plural(preview.untranscribed.length, "screenshot")}`}
            tone="secondary"
            inline
            fields={[...base, ...preview.untranscribed.map((u, i) => ({ name: "imageVersionId", type: "hidden" as const, defaultValue: u.versionId, key: i }))]}
          />
        </div>
      ) : null}
      <details className="disclosure" open={!latest}>
        <summary>What will be sent</summary>
        <ul className="list compact">
          <li>
            To: {preview.host} (model {preview.modelName})
          </li>
          <li>{plural(preview.requests.length, "request")}: {preview.requests.map((r) => r.party).join(", ") || "none"}</li>
          <li>
            {plural(preview.sources.length, "source")}:{" "}
            {preview.sources.map((s) => `${s.name} (${plural(s.chars, "character")})`).join(", ") || "none"}
          </li>
          <li>About {preview.inputTokens.toLocaleString("en-US")} input tokens (estimate)</li>
          <li>Estimated cost: {preview.cost ? `$${preview.cost.min.toFixed(4)} – $${preview.cost.max.toFixed(4)}` : "unknown (no prices set)"}</li>
        </ul>
      </details>
      {preview.blockers.map((b) => (
        <p key={b} className="warn">
          {b}
        </p>
      ))}
      {!preview.blockers.length && !active.length ? (
        <Form action={startAbstractionAction} submit={lastGood ? "Regenerate" : "Draft analysis"} fields={base} />
      ) : null}
      {lastGood ? <p className="help">Regenerating replaces AI claims you have not reviewed. Claims you accepted, corrected or rejected are kept.</p> : null}
    </section>
  );
}

async function ReportStep({ productId, analysisId, pending }: { productId: string; analysisId: string; pending: number }) {
  const db = await getDb();
  const [versions, draft] = await Promise.all([listReportVersions(db, productId, analysisId), buildSnapshot(db, productId, analysisId)]);
  const status = reportStatus(draft);
  const open = openItems(draft);
  const steps = nextSteps(draft);
  const base = `/p/${productId}/a/${analysisId}`;
  const STEP_KIND = { decide: "Decisions needed", supply: "Material to supply or confirm", verify: "To verify", review: "Suggestions to review" } as const;

  return (
    <section className="section">
      <div className="card">
        <h2>Save a report version</h2>
        <p>
          Saving now gives the status <strong>{REPORT_STATUS[status]}</strong>
          {pending ? ` (${plural(pending, "claim")} still pending, so it saves as a draft)` : ""}
          {open.length ? `; ${plural(open.length, "open item")} will be listed in the report` : ""}.
        </p>
        <p className="help">Each save creates a new version that cannot be changed; older versions stay available. "Reviewed" only means every claim was checked, not that the report is correct or complete.</p>
        <Form
          action={saveReportAction}
          submit="Save report version"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "analysisId", type: "hidden", defaultValue: analysisId },
          ]}
        />
      </div>
      <div className="card">
        <h2>Suggested next steps ({steps.length})</h2>
        <p className="help">Assembled from reviewed claims and confirmed dependencies, and included in the report. An action list, not conclusions.</p>
        {steps.length ? (
          (["decide", "supply", "verify", "review"] as const).map((k) => {
            const list = steps.filter((s) => s.kind === k);
            if (!list.length) return null;
            return (
              <div key={k}>
                <h3>{STEP_KIND[k]}</h3>
                <ol>
                  {list.map((s, i) => (
                    <li key={i}>{s.text}</li>
                  ))}
                </ol>
              </div>
            );
          })
        ) : (
          <p className="empty">No conflicts, unknowns or dependencies to act on yet.</p>
        )}
      </div>
      <h2>Saved versions</h2>
      {versions.length ? (
        <ul className="list">
          {versions.map((v) => (
            <li key={v.id}>
              <Link href={`${base}/reports/${v.version}`}>v{v.version}</Link> <span className={`tag report-${v.status}`}>{REPORT_STATUS[v.status]}</span>
              <span className="muted"> · {fmtDate(v.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No report versions saved yet.</p>
      )}
    </section>
  );
}
