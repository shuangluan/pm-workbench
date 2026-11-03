# PM Evidence Workbench（暂名）

帮助平台与 B 端 PM 把多方诉求整理成有原文依据的通用能力方案，并列出需要验证的系统影响、冲突和未知项。规格见 PRD v0.5。

> **状态：M1 预览，尚无 AI 功能。** 可以在本机完成不依赖模型的完整流程：录入需求与资料 → 添加有引用的分析条目 → 逐条核对 → 保存报告版本 → 导出 Markdown / 产品 ZIP。模型适配、需求拆分、抽象与影响推断属于 M2–M3。

## 本机运行（不需要 Docker）

需要 Node.js ≥ 22。数据保存在项目根目录的 `.data/`（内嵌 Postgres，PGlite）。

```bash
npm install
```

```bash
npm run dev
```

服务只监听 `http://127.0.0.1:3210`。第一次使用时，在另一个终端获取一次性初始化码：

```bash
npm run access:reset
```

打开 `http://127.0.0.1:3210/login`，输入初始化码并设置访问口令。之后可以选择“载入示例”查看合成的批量导出案例，或创建自己的产品。

生产模式：

```bash
npm run build && npm start
```

## Docker Compose（未在本机验证）

`compose.yaml` 使用 Postgres 17，Web 端口只绑定到主机的 `127.0.0.1:3210`，数据库不暴露端口。这台开发机没有 Docker，**这套配置还没有实际跑过**；镜像标签已确认存在。

```bash
cp .env.example .env
```

编辑 `.env` 设置 `PEW_DB_PASSWORD`，然后：

```bash
docker compose up --build
```

```bash
docker compose exec web npm run access:reset
```

不要把这个服务开放到局域网或公网：它没有 TLS，也没有多用户权限。

## 数据流向

- 所有资料、需求、条目和报告只保存在本机（`.data/` 或 Compose 的数据卷）。
- 当前版本**不会向任何外部服务发送数据**：没有模型调用、遥测或自动更新检查。
- 资料中的原始链接只作为记录保存，不会被访问。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（127.0.0.1:3210） |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run access:reset` | 生成一次性初始化码；所有已登录会话立即失效 |
| `npm run doctor` | 检查 Node、数据目录、迁移与数据库（不打印正文） |
| `npm run check` | 类型检查 + 全部测试 |
| `npm run db:generate` | 修改 schema 后生成迁移 |

备份、恢复与升级见 [docs/recovery.md](docs/recovery.md)。

## 已完成

| 部分 | 位置 | PRD |
| --- | --- | --- |
| 证据定位、引用校验、图查询、核对、报告与精简规格渲染 | `packages/core` | §3、F05–F08 |
| Postgres 表结构与迁移；复合外键在数据库层拒绝跨产品引用 | `packages/db/src/schema.ts`、`migrations/` | §7.3、F02 |
| 本地访问：CLI 一次性初始化码、scrypt 口令、会话哈希、重置即失效 | `packages/db/src/access.ts`、`scripts/` | F01、§8.2 |
| 产品、资料（版本、去重、按原句添加引用、永久删除并清理已保存报告）、需求（原话独立保存、幂等创建、修正生成新版本）、分析范围 | `packages/db/src/services` | F02–F04、§8.3 |
| 手工条目（标为“用户输入”，与 AI 结果同样校验）、接受/修正/不采纳、乐观锁 | 同上 | F08、§6.3 |
| 报告版本快照、Markdown 报告与精简规格（中/英标题） | 同上 | F08 |
| 产品 ZIP 导出/导入：校验和、内容哈希、路径与大小限制、ID 全部重映射、导入为新产品 | `services/portability.ts` | F09、§8.2 |
| Web 工作台：产品、资料查看器（行号与引用高亮）、需求、分析三步页、报告、导入、诊断 | `apps/web` | §4 |
| 仅回环地址、Host 校验、跨站写请求拒绝、HttpOnly + SameSite=Strict 会话 | `apps/web/proxy.ts` | §8.2 |

## 尚未实现

- **M2**：模型配置与两个适配器、用量记录、worker 与任务队列、需求拆分、抽象分析。
- **M3**：局部记忆页面（节点/关系确认）、影响检查页面（核心图查询已完成）、影响推断。
- 整实例备份/恢复脚本（目前为手工步骤）、上传原始文件的保存（目前只保存规范化文本）、需求删除、窄屏证据抽屉。
- 评测集、许可证（PRD 推荐 AGPL-3.0-only，待负责人确认）。

## 已知限制

- PGlite 同一时间只允许一个进程打开数据目录。服务运行时 `npm run doctor` 会跳过数据库检查；`access:reset` 不访问数据库，可以随时运行。
- 字符偏移按 UTF-16 码元计算；字符上限按码点计算。
- `npm audit` 报告的中危问题都在开发依赖中（vitest、drizzle-kit 内部的 esbuild）。
