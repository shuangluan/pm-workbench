import { statfsSync } from "node:fs";
import { schema } from "@pew/db";
import { count } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, getHandle } from "@/lib/db";

function freeSpace(path: string): string {
  try {
    const s = statfsSync(path);
    return `${((s.bavail * s.bsize) / 1024 ** 3).toFixed(1)} GB 可用`;
  } catch {
    return "未知";
  }
}

export default async function SettingsPage() {
  const handle = await getHandle();
  const db = await getDb();
  const [products] = await db.select({ n: count() }).from(schema.products);
  const [runs] = await db.select({ n: count() }).from(schema.analysisRuns);

  return (
    <>
      <h1>设置与诊断</h1>
      <section className="card">
        <h2>运行状态</h2>
        <dl className="kv">
          <dt>软件版本</dt>
          <dd>{config.version}（M1 预览，无 AI 功能）</dd>
          <dt>数据库</dt>
          <dd>
            {handle.kind === "pglite" ? "内嵌 Postgres（PGlite）" : "Postgres"} · <code>{handle.location}</code>
          </dd>
          <dt>数据目录</dt>
          <dd>
            <code>{config.dataDir}</code> · {freeSpace(config.dataDir)}
          </dd>
          <dt>产品数</dt>
          <dd>{products!.n}</dd>
          <dt>任务记录</dt>
          <dd>{runs!.n}</dd>
          <dt>网络</dt>
          <dd>无遥测、无自动更新检查。当前版本不会向任何外部服务发送数据。</dd>
        </dl>
      </section>
      <section className="card">
        <h2>模型</h2>
        <p>尚未提供。模型配置、连接测试和用量记录将在 M2 加入；配置后，只有你选定的资料会发送给你配置的模型服务。</p>
      </section>
      <section className="card">
        <h2>备份与恢复</h2>
        <p>
          产品级迁移：在产品页“导出产品”，在“导入”页恢复为新产品。整实例备份与恢复脚本尚未提供，见 <code>docs/recovery.md</code> 中的手工步骤。
        </p>
        <p className="help">
          重置访问口令：在项目目录运行 <code>npm run access:reset</code>，所有已登录会话立即失效。
        </p>
      </section>
    </>
  );
}
