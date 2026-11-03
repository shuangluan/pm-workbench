import { openItems, reportStatus, type ClaimKind, type ClaimSection } from "@pew/core";
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
  type ClaimView,
} from "@pew/db";
import Link from "next/link";
import {
  addClaimAction,
  archiveAnalysisAction,
  deleteAnalysisAction,
  reviewAction,
  saveReportAction,
  setScopeAction,
  updateAnalysisAction,
} from "@/app/actions";
import { Form } from "@/components/Form";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";
import { ANALYSIS_STATUS, fmtDate, KIND, KIND_HELP, REJECT, REPORT_STATUS, REVIEW, SECTION, VALIDITY } from "@/lib/labels";

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
  searchParams: Promise<{ step?: string }>;
}) {
  const { productId, analysisId } = await params;
  const requested = (await searchParams).step;
  const step: Step = STEPS.find((s) => s.id === requested)?.id ?? "scope";
  const db = await getDb();
  const product = await found(getProduct(db, productId));
  const analysis = await found(getAnalysis(db, productId, analysisId));
  const claims = await listClaims(db, productId, analysisId);
  const pending = claims.filter((c) => c.review === "pending").length;
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

      <nav className="tabs" aria-label="分析步骤">
        {STEPS.map((s) => (
          <Link key={s.id} href={`${base}?step=${s.id}`} aria-current={s.id === step ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>

      {step === "scope" ? <ScopeStep productId={productId} analysis={analysis} /> : null}
      {step === "claims" ? <ClaimsStep productId={productId} analysis={analysis} claims={claims} archived={archived} /> : null}
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

  return (
    <section className="section">
      <p className="help">
        选择本次分析使用的需求与资料。保存后，已保存的报告不受影响；分析状态回到草稿。当前已选资料共 {totalChars.toLocaleString()} 字符。
      </p>
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
                .map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}`, hint: `${s.charCount.toLocaleString()} 字符` })),
              ...staleSelected.map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}`, hint: "旧版本" })),
            ],
          },
        ]}
      />
      <p className="help">
        还缺资料或需求？<Link href={`/p/${productId}/sources/new`}>添加资料</Link> · <Link href={`/p/${productId}/requests/new`}>录入需求</Link>
      </p>
    </section>
  );
}

async function ClaimsStep({ productId, analysis, claims, archived }: { productId: string; analysis: AnalysisData; claims: ClaimView[]; archived: boolean }) {
  const db = await getDb();
  const requests = await listRequests(db, productId, analysis.requestIds);
  const scopeVersionIds = [...analysis.selectedSources.map((s) => s.versionId)];
  const pickable = await listEvidence(db, productId, { versionIds: scopeVersionIds });
  const requestEvidence = await listEvidence(db, productId, { ids: requests.map((r) => r.originalEvidenceId) });
  const cited = await listEvidence(db, productId, { ids: [...new Set(claims.flatMap((c) => c.evidenceIds))] });
  const evidence = new Map([...cited, ...pickable, ...requestEvidence].map((e) => [e.id, e]));
  const sections = [...new Set([...CLAIM_SECTIONS, ...claims.map((c) => c.section)])];

  return (
    <section className="section">
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
        <p className="empty">还没有条目。模型分析将在后续版本提供；现在可以手工添加条目。</p>
      )}

      {!archived ? (
        <details className="disclosure" open={!claims.length}>
          <summary>添加条目（用户输入）</summary>
          <p className="help">
            手工条目标为“用户输入”，并按与 AI 结果相同的规则校验：原文事实必须带引用；推断需要理由和引用；建议需要理由；未知需要说明缺什么。
          </p>
          <Form
            action={addClaimAction}
            submit="添加条目"
            fields={[
              { name: "productId", type: "hidden", defaultValue: productId },
              { name: "analysisId", type: "hidden", defaultValue: analysis.id },
              { name: "section", label: "分区", type: "select", options: CLAIM_SECTIONS.map((s) => ({ value: s, label: SECTION[s] })) },
              {
                name: "kind",
                label: "结论类型",
                type: "select",
                options: (["source_fact", "inference", "suggestion", "unknown"] as ClaimKind[]).map((k) => ({ value: k, label: `${KIND[k]} — ${KIND_HELP[k]}` })),
              },
              { name: "text", label: "内容", type: "textarea", rows: 3, required: true },
              { name: "reasoning", label: "理由 / 推导（推断、建议必填）", type: "textarea", rows: 2 },
              { name: "missing", label: "缺少什么、找谁确认（未知必填）", type: "textarea", rows: 2 },
              {
                name: "evidenceIds",
                label: "引用已有原句",
                type: "checkboxes",
                options: [...requestEvidence, ...pickable].map((e) => ({
                  value: e.id,
                  label: (e.quote ?? "［已删除］").slice(0, 120),
                  hint: `${e.sourceKind === "request_text" ? "需求原话" : e.sourceName} v${e.version} L${e.lineStart}`,
                })),
              },
              {
                name: "newQuoteVersionId",
                label: "或新增一条引用：来自",
                type: "select",
                options: [{ value: "", label: "（不新增）" }, ...analysis.selectedSources.filter((s) => s.validity === "valid").map((s) => ({ value: s.versionId, label: `${s.name} v${s.version}` }))],
              },
              { name: "newQuote", label: "从原文复制的句子", type: "textarea", rows: 2 },
            ]}
          />
        </details>
      ) : null}
    </section>
  );
}

async function ReportStep({ productId, analysisId, pending }: { productId: string; analysisId: string; pending: number }) {
  const db = await getDb();
  const [versions, draft] = await Promise.all([listReportVersions(db, productId, analysisId), buildSnapshot(db, productId, analysisId)]);
  const status = reportStatus(draft);
  const open = openItems(draft);
  const base = `/p/${productId}/a/${analysisId}`;

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
