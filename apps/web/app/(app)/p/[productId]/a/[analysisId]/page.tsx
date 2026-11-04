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
import { ANALYSIS_STATUS, NODE_TYPE, fmtDate, KIND, KIND_HELP, REJECT, REPORT_STATUS, REVIEW, SECTION, VALIDITY } from "@/lib/labels";

const STEPS = [
  { id: "scope", label: "1 · 需求与资料" },
  { id: "claims", label: "2 · 条目核对" },
  { id: "report", label: "3 · 报告" },
  { id: "settings", label: "设置" },
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
    <article className={`claim claim-${claim.review}`} aria-label={`${KIND[claim.kind]}：${claim.text.slice(0, 40)}`}>
      <header className="claim-tags">
        <span className={`tag kind-${claim.kind}`}>{KIND[claim.kind]}</span>
        <span className="tag">{claim.origin === "user" ? "用户输入" : "AI 生成"}</span>
        <span className={`tag review-${claim.review}`}>{REVIEW[claim.review]}</span>
        {claim.evidenceValidity !== "valid" ? <span className="tag tag-warn">{VALIDITY[claim.evidenceValidity]}</span> : null}
        {claim.rejectReason ? <span className="tag">原因：{REJECT[claim.rejectReason]}</span> : null}
      </header>
      <p className="claim-text">{claim.text}</p>
      {claim.reasoning ? <p className="claim-meta">推导：{claim.reasoning}</p> : null}
      {claim.missing ? <p className="claim-meta">需补充：{claim.missing}</p> : null}
      {claim.original ? (
        <p className="claim-meta">
          原 AI 内容（{KIND[claim.original.kind]}）：<s>{claim.original.text}</s>
        </p>
      ) : null}
      {claim.rejectNote ? <p className="claim-meta">说明：{claim.rejectNote}</p> : null}
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
                <span className="quote">{e.quote ?? "［来源已删除，原句不再保留］"}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="claim-meta muted">无引用</p>
      )}
      <div className="claim-actions">
        {claim.review !== "accepted" ? (
          <Form action={reviewAction} submit="接受" tone="secondary" inline fields={[...hidden, { name: "type", type: "hidden", defaultValue: "accept" }]} />
        ) : null}
        {claim.review !== "pending" ? (
          <Form action={reviewAction} submit="改回待核对" tone="secondary" inline fields={[...hidden, { name: "type", type: "hidden", defaultValue: "reopen" }]} />
        ) : null}
        <details className="disclosure inline-disclosure">
          <summary>修正</summary>
          <Form
            action={reviewAction}
            submit="保存修正"
            fields={[...hidden, { name: "type", type: "hidden", defaultValue: "correct" }, { name: "text", label: "修正后的内容", type: "textarea", rows: 3, required: true, defaultValue: claim.text }]}
          />
        </details>
        {claim.review !== "rejected" ? (
          <details className="disclosure inline-disclosure">
            <summary>不采纳</summary>
            <Form
              action={reviewAction}
              submit="标记不采纳"
              tone="danger"
              fields={[
                ...hidden,
                { name: "type", type: "hidden", defaultValue: "reject" },
                { name: "reason", label: "原因", type: "select", options: Object.entries(REJECT).map(([value, label]) => ({ value, label })) },
                { name: "note", label: "说明（选“其他”时必填）", type: "text" },
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
      ? { step: "scope", text: "选择本次分析的需求与资料" }
      : pending
        ? { step: "claims", text: `核对 ${pending} 条待核对条目` }
        : claims.length
          ? { step: "report", text: "保存报告版本并导出" }
          : { step: "claims", text: "添加分析条目" };

  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>{analysis.title}</span>
      </nav>
      <h1>{analysis.title}</h1>
      <div className="statusbar" role="status">
        <span className={`tag tag-${analysis.status}`}>{ANALYSIS_STATUS[analysis.status]}</span>
        <span>
          {analysis.requestIds.length} 条需求 · {analysis.selectedSources.length} 份资料 · {claims.length} 条条目
        </span>
        <span className={pending ? "warn" : undefined}>待核对 {pending}</span>
        {!archived ? (
          <span>
            下一步：<Link href={`${base}?step=${next.step}`}>{next.text}</Link>
          </span>
        ) : null}
      </div>
      {analysis.goal ? <p>目标：{analysis.goal}</p> : null}
      {analysis.changeDescription ? <p className="muted">改动描述：{analysis.changeDescription}</p> : null}
      {archived ? <p className="banner banner-warn">该分析已归档，只读。可在“设置”中取消归档。</p> : null}
      {created ? (
        <p className="banner banner-info">
          已创建：{analysis.requestIds.length} 条需求、{analysis.selectedSources.length} 份资料/截图，都已加入本次分析。下一步：让模型生成分析，或打开资料划选依据手工添加条目。
        </p>
      ) : null}

      <nav className="tabs" aria-label="分析步骤">
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
              <h2>基本信息</h2>
              <Form
                action={updateAnalysisAction}
                submit="保存"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "analysisId", type: "hidden", defaultValue: analysisId },
                  { name: "revision", type: "hidden", defaultValue: String(analysis.revision) },
                  { name: "title", label: "标题", type: "text", required: true, defaultValue: analysis.title },
                  { name: "goal", label: "本次目标", type: "textarea", rows: 2, defaultValue: analysis.goal },
                  { name: "changeDescription", label: "改动描述", type: "textarea", rows: 2, defaultValue: analysis.changeDescription },
                ]}
              />
            </section>
            <section className="card">
              <h2>影响检查起点</h2>
              {memory?.nodes.length ? (
                <>
                  <p className="help">
                    选择这次改动直接涉及的模块或数据对象。报告会沿已确认的关系找出依赖它们的对象，并列出需要验证的问题。未确认的关系不参与。
                  </p>
                  <Form
                    action={setChangeNodesAction}
                    submit="保存起点"
                    tone="secondary"
                    fields={[
                      { name: "productId", type: "hidden", defaultValue: productId },
                      { name: "analysisId", type: "hidden", defaultValue: analysisId },
                      {
                        name: "nodeIds",
                        label: "变更对象",
                        type: "checkboxes",
                        defaultValue: analysis.changeNodeIds,
                        options: memory.nodes.map((n) => ({ value: n.id, label: n.name, hint: NODE_TYPE[n.type] })),
                      },
                    ]}
                  />
                </>
              ) : (
                <p className="help">这个产品还没有已确认的模块与关系。局部记忆页面将在后续版本提供；示例产品中可以先体验。</p>
              )}
            </section>
            <section className="card">
              <h2>归档与删除</h2>
              <p className="help">归档保留全部内容，只是变为只读。删除会移除这次分析的条目和报告版本，保留产品中的需求与资料。</p>
              <Form
                action={archiveAnalysisAction}
                submit={archived ? "取消归档" : "归档"}
                tone="secondary"
                fields={[
                  { name: "productId", type: "hidden", defaultValue: productId },
                  { name: "analysisId", type: "hidden", defaultValue: analysisId },
                  { name: "to", type: "hidden", defaultValue: archived ? "draft" : "archived" },
                ]}
              />
              <details className="disclosure danger-zone">
                <summary>永久删除分析</summary>
                <Form
                  action={deleteAnalysisAction}
                  submit="永久删除"
                  tone="danger"
                  fields={[
                    { name: "productId", type: "hidden", defaultValue: productId },
                    { name: "analysisId", type: "hidden", defaultValue: analysisId },
                    { name: "confirm", label: "输入“删除”以确认", type: "text", required: true },
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
  const kindLabel = (k: string) => (k === "image" ? "截图" : k === "transcript" ? "转写" : "");

  return (
    <section className="section">
      <div className="grid-2">
        <section className="card">
          <h2>添加需求</h2>
          <p className="help">粘贴聊天记录、表格或列表，预览确认后自动加入本次分析。</p>
          <p>
            <Link className="btn btn-primary" href={`${base}/requests/new?${q}`}>
              批量录入需求
            </Link>
          </p>
        </section>
        <section className="card">
          <h2>添加聊天截图</h2>
          <ScreenshotUploadForm action={uploadImagesAction} productId={productId} analysisId={analysis.id} />
        </section>
      </div>

      {analysis.selectedSources.length ? (
        <>
          <h2>本次资料</h2>
          <ul className="list">
            {analysis.selectedSources.map((s) => (
              <li key={s.versionId}>
                <Link href={`${base}/sources/${s.sourceId}?v=${s.versionId}&${q}`}>
                  {s.name} v{s.version}
                </Link>
                {kindLabel(s.kind) ? <span className="tag">{kindLabel(s.kind)}</span> : null}
                <span className="muted">
                  {" "}
                  · {s.kind === "image" ? "打开后可转写" : "打开后可划选引用"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <details className="disclosure">
        <summary>调整范围（勾选本次使用的需求与资料）</summary>
        <p className="help">已选文字资料共 {totalChars.toLocaleString()} 字符。保存后，已保存的报告不受影响；分析状态回到草稿。</p>
        {staleSelected.length ? (
          <p className="banner banner-warn">
            已选的 {staleSelected.map((s) => `“${s.name}” v${s.version}`).join("、")} 有更新版本。保留旧版本会继续使用旧原文；如需更新，请勾选新版本。
          </p>
        ) : null}
        <Form
          action={setScopeAction}
          submit="保存范围"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "analysisId", type: "hidden", defaultValue: analysis.id },
            { name: "revision", type: "hidden", defaultValue: String(analysis.revision) },
            {
              name: "requestIds",
              label: "需求",
              type: "checkboxes",
              defaultValue: analysis.requestIds,
              options: requests.map((r) => ({
                value: r.id,
                label: `${r.party}：${(r.fields as Record<string, string>).title || (r.originalText ?? "").slice(0, 40)}`,
                hint: (r.originalText ?? "［来源已删除］").slice(0, 80),
              })),
            },
            {
              name: "sourceVersionIds",
              label: "资料（当前版本）",
              type: "checkboxes",
              defaultValue: analysis.selectedSources.map((s) => s.versionId),
              options: [
                ...sources
                  .filter((s) => s.validity === "valid")
                  .map((s) => ({
                    value: s.versionId,
                    label: `${s.name} v${s.version}`,
                    hint: s.kind === "image" ? "截图" : `${s.charCount.toLocaleString()} 字符${s.kind === "transcript" ? " · 转写" : ""}`,
                  })),
                ...staleSelected.map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}`, hint: "旧版本" })),
              ],
            },
          ]}
        />
        <p className="help">
          文字资料（规则、接口说明）请在 <Link href={`${base}/sources/new`}>添加资料</Link> 页上传。
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
          <h2>诉求覆盖</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">需求</th>
                  <th scope="col">业务方</th>
                  <th scope="col">目标</th>
                  <th scope="col">共同部分</th>
                  <th scope="col">特有约束</th>
                  <th scope="col">处理方式</th>
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
                {SECTION[section as ClaimSection]} <span className="muted">（{list.length}）</span>
              </h2>
              {list.map((c) => (
                <ClaimCard key={c.id} claim={c} evidence={evidence} productId={productId} />
              ))}
            </div>
          );
        })
      ) : (
        <p className="empty">还没有条目。可以让模型生成，也可以手工添加。</p>
      )}

      {!archived ? (
        <details className="disclosure" id="add-claim" open={!claims.length || !!cite}>
          <summary>添加条目（用户输入）</summary>
          <p className="help">
            最快的方式：打开资料，<strong>用鼠标选中一句话</strong>，点“以此为依据添加条目”。
            {textSources.length ? (
              <>
                {" "}
                打开：
                {textSources.map((s, i) => (
                  <span key={s.versionId}>
                    {i ? "、" : ""}
                    <Link href={`/p/${productId}/sources/${s.sourceId}?v=${s.versionId}&analysis=${analysis.id}`}>{s.name}</Link>
                  </span>
                ))}
              </>
            ) : null}
          </p>
          <Form
            action={addClaimAction}
            submit="添加条目"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "analysisId", type: "hidden", defaultValue: analysis.id },
              {
                name: "kind",
                label: "这是什么",
                type: "select",
                options: (["source_fact", "inference", "suggestion", "unknown"] as ClaimKind[]).map((k) => ({ value: k, label: `${KIND[k]} — ${KIND_HELP[k]}` })),
              },
              { name: "text", label: "内容", type: "textarea", rows: 3, required: true },
              { name: "reasoning", label: "理由 / 推导", type: "textarea", rows: 2, required: true, showWhen: { field: "kind", in: ["inference", "suggestion"] } },
              { name: "missing", label: "缺少什么、找谁确认", type: "textarea", rows: 2, required: true, showWhen: { field: "kind", in: ["unknown"] } },
              {
                name: "evidenceIds",
                label: "依据",
                type: "checkboxes",
                defaultValue: cite ? [cite] : [],
                options: options.map((e) => ({
                  value: e.id,
                  label: (e.quote ?? "［已删除］").slice(0, 120),
                  hint: `${e.sourceKind === "request_text" ? "需求原话" : e.sourceName} v${e.version} L${e.lineStart}${e.id === cite ? " · 刚选中" : ""}`,
                })),
              },
              {
                name: "section",
                label: "放在报告的哪一节",
                type: "select",
                advanced: true,
                options: CLAIM_SECTIONS.map((s) => ({ value: s, label: SECTION[s] })),
              },
              {
                name: "newQuoteVersionId",
                label: "粘贴原句新增引用：来自",
                type: "select",
                advanced: true,
                options: [{ value: "", label: "（不新增）" }, ...textSources.map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}` }))],
              },
              { name: "newQuote", label: "从原文复制的句子", type: "textarea", rows: 2, advanced: true },
            ]}
          />
        </details>
      ) : null}
    </section>
  );
}

const HANDLING: Record<string, string> = { shared_capability: "纳入通用能力", configuration: "配置/扩展", separate: "分开处理", not_covered: "未覆盖" };

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
        <h2>让模型生成分析</h2>
        <p>
          配置模型后，可以一键生成共同问题、通用能力建议、冲突和未知项，并读取聊天截图。<Link href="/settings#model">去配置模型</Link>
        </p>
        <p className="help">不配置模型也能手工完成全部流程。</p>
      </section>
    );
  }

  return (
    <section className="card ai-panel">
      <RunWatcher url={`/p/${productId}/a/${analysis.id}/runs`} active={active.map((r) => `${r.id}:${r.status}`).join()} />
      <h2>让模型生成分析</h2>
      {active.map((r) => (
        <div key={r.id} className="run-line" role="status">
          <span className="tag tag-pending_review">{RUN_STATUS[r.status]}</span>
          <span>{TASK_LABEL[r.taskType] ?? r.taskType}</span>
          <Form action={cancelRunAction} submit="取消" tone="secondary" inline fields={[{ name: "productId", type: "hidden", defaultValue: productId }, { name: "runId", type: "hidden", defaultValue: r.id }]} />
        </div>
      ))}
      {active.length ? <p className="help">运行时可以继续做别的事，也可以关闭页面。取消会尽力中止请求，但服务商可能已经计费。</p> : null}
      {failed.map((r) => {
        const risky = r.errorKind === "outcome_unknown" || r.errorKind === "interrupted";
        return (
          <div key={r.id} className="banner banner-danger">
            <p>
              {TASK_LABEL[r.taskType] ?? r.taskType}{RUN_STATUS[r.status]}：{r.errorMessage}
            </p>
            {r.errorKind && FAILURE_HINT[r.errorKind] ? <p>{FAILURE_HINT[r.errorKind]}</p> : null}
            <Form
              action={retryRunAction}
              submit="重试"
              tone="secondary"
              inline
              confirm={risky ? "上次的结果未知，服务商可能已经计费。重试可能产生额外费用，继续吗？" : undefined}
              fields={[
                { name: "productId", type: "hidden", defaultValue: productId },
                { name: "runId", type: "hidden", defaultValue: r.id },
                { name: "key", type: "hidden", defaultValue: crypto.randomUUID() },
              ]}
            />
          </div>
        );
      })}
      {stale ? <p className="banner banner-warn">需求或资料范围已变化，当前结果基于旧范围。可以重新生成。</p> : null}
      {preview.untranscribed.length ? (
        <div className="section">
          <p>
            有 {preview.untranscribed.length} 张截图还没有转写，<strong>不会</strong>进入分析。读取时，截图原图会发送给 {preview.host}。
          </p>
          <Form
            action={startTranscribeAction}
            submit={`读取 ${preview.untranscribed.length} 张截图`}
            tone="secondary"
            inline
            fields={[...base, ...preview.untranscribed.map((u, i) => ({ name: "imageVersionId", type: "hidden" as const, defaultValue: u.versionId, key: i }))]}
          />
        </div>
      ) : null}
      <details className="disclosure" open={!latest}>
        <summary>这次会发送什么</summary>
        <ul className="list compact">
          <li>
            发送到：{preview.host}（模型 {preview.modelName}）
          </li>
          <li>需求 {preview.requests.length} 条：{preview.requests.map((r) => r.party).join("、") || "无"}</li>
          <li>
            资料 {preview.sources.length} 份：
            {preview.sources.map((s) => `${s.name}（${s.chars.toLocaleString()} 字符）`).join("、") || "无"}
          </li>
          <li>约 {preview.inputTokens.toLocaleString()} 输入 tokens（估算）</li>
          <li>估算费用：{preview.cost ? `$${preview.cost.min.toFixed(4)} – $${preview.cost.max.toFixed(4)}` : "未知（未填写单价）"}</li>
        </ul>
      </details>
      {preview.blockers.map((b) => (
        <p key={b} className="warn">
          {b}
        </p>
      ))}
      {!preview.blockers.length && !active.length ? (
        <Form action={startAbstractionAction} submit={lastGood ? "重新生成" : "生成分析"} fields={base} />
      ) : null}
      {lastGood ? <p className="help">重新生成会替换未核对的 AI 条目；你已接受、修正或不采纳的条目会保留。</p> : null}
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
  const STEP_KIND = { decide: "需要决策", supply: "需要补充或确认", verify: "需要验证", review: "需要评审的建议" } as const;

  return (
    <section className="section">
      <div className="card">
        <h2>保存报告版本</h2>
        <p>
          当前内容保存后的状态：<strong>{REPORT_STATUS[status]}</strong>
          {pending ? `（还有 ${pending} 条待核对，只能保存为草稿）` : ""}
          {open.length ? `，${open.length} 个未决项会写入报告` : ""}。
        </p>
        <p className="help">每次保存都会生成不可修改的新版本；旧版本始终可以查看。“已核对”只表示所有条目都检查过，不保证正确或完整。</p>
        <Form
          action={saveReportAction}
          submit="保存报告版本"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "analysisId", type: "hidden", defaultValue: analysisId },
          ]}
        />
      </div>
      <div className="card">
        <h2>建议的下一步（{steps.length}）</h2>
        <p className="help">由已核对条目和已确认依赖自动整理，会写入报告。这是行动清单，不是结论。</p>
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
          <p className="empty">还没有可整理的冲突、未知项或依赖。</p>
        )}
      </div>
      <h2>已保存版本</h2>
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
        <p className="empty">还没有保存的报告版本。</p>
      )}
    </section>
  );
}
