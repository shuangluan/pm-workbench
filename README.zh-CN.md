# PM Evidence Workbench（暂名）

[English](README.md) | **简体中文**

帮助平台与 B 端 PM 把多方诉求整理成有原文依据的通用能力方案，并列出需要验证的系统影响、冲突和未知项。规格见 PRD v0.5。

> **状态：M2 预览。** 快速开始（粘贴聊天记录 / 表格 / 截图 + 资料）→ 用你自己的模型生成抽象分析，或手工添加条目 → 逐条核对 → 保存报告版本（含“建议的下一步”）→ 导出 Markdown / 产品 ZIP。没有模型也能手工走完全流程。**模型路径目前只用模拟服务和本地测试验证过，还没有用真实模型跑过评测**，分析质量未知。影响推断和局部记忆页面属于 M3。与 PRD v0.5 的差异见 [docs/scope-changes.md](docs/scope-changes.md)。

## 本机运行（不需要 Docker）

需要 Node.js ≥ 22。数据保存在项目根目录的 `.data/`（内嵌 Postgres，PGlite）。

```bash
npm install
```

```bash
npm run dev
```

服务只监听 `http://127.0.0.1:3210`。第一次启动时，终端会在服务启动前显示一次性初始化码；打开 `http://127.0.0.1:3210/login`，输入它并设置访问口令。之后点“快速开始一次分析”，或先看示例结果。

没有看到初始化码（例如输出被重定向），或忘记口令时，运行下面的命令。使用了自定义 `PEW_DATA_DIR` 时，登录页会显示带目录的完整命令：

```bash
npm run access:reset
```

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

- 所有资料、需求、条目和报告保存在本机（`.data/` 或 Compose 的数据卷）。
- 只有你点击运行任务时，所选的需求、资料片段或截图原图才会发送给你配置的模型服务，运行前页面会列出发送内容和目标地址。这些内容受该服务商条款约束，所以“本地运行”不等于“数据不出本机”，除非你用的也是本地模型。
- 模型密钥加密保存，不进入产品导出包。
- 没有遥测，没有自动更新检查，不会自动访问资料中的链接。

## 不用模型密钥试用

启动本地模拟模型，不产生费用，20 分钟后自动退出：

```bash
npm run mock-model
```

然后在“设置与诊断”中选择 OpenAI 兼容接口，端点填 `http://127.0.0.1:11555/v1`，开启本地模型模式，密钥随意。它的输出是带【模拟】标记的固定合成内容，只用于走通流程，不能用来判断分析质量。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（127.0.0.1:3210） |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run access:reset` | 生成一次性初始化码；所有已登录会话立即失效 |
| `npm run doctor` | 检查 Node、数据目录、迁移与数据库（不打印正文） |
| `npm run mock-model` | 本地模拟模型，不花钱走通模型流程（输出是合成内容） |
| `npm run licenses` | 重新生成第三方依赖许可清单 |
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
| 快速开始：一页放入需求、截图与资料，一次创建产品、资料、需求和已选好范围的分析 | `apps/web/app/(app)/start`、`services/quickstart.ts` | 范围变更 |
| 规则拆分：表格、聊天记录、“业务方：原话”、列表、段落；CSV；PM 自己的追问与回答归入同一需求 | `packages/core/src/split.ts` | F03 |
| 聊天截图：粘贴/拖入/选择，原图保存与去重，手动转写（带版本、链接原图），从转写拆分需求 | `services/media.ts` | 范围变更 |
| 划选引用：在原文中选中文字即可引用，或直接以它为依据添加条目 | `components/SelectToCite.tsx` | §3.3 |
| 报告“建议的下一步”；示例含已确认依赖检查与验证问题 | `packages/core/src/report.ts`、`services/memory.ts` | F07、F08 |
| 模型接入：Anthropic 与 OpenAI 兼容两个适配器，密钥加密，端点安全校验，连接测试 | `packages/model-adapters`、`services/models.ts` | F01、§7.2、§8.2 |
| 持久任务队列：冻结输入、幂等、取消、中断恢复、最多自动重试一次、每次尝试记录用量 | `services/runs.ts`、`services/worker.ts` | §6.1 |
| 需求抽象、截图读取、模型拆分；输出校验未通过的结果不进入条目 | `packages/core/src/tasks.ts` | F03、F06、§6.2 |

## 尚未实现

- **M2 剩余**：评测集与真实模型验证（M2 的退出条件，尚未满足）、每日 token 软预算。
- **M3**：局部记忆页面（节点/关系确认）、影响检查页面（核心图查询已完成）、影响推断。
- 整实例备份/恢复脚本（目前为手工步骤）、上传文本文件原件的保存（目前只保存规范化文本；截图保存原图）、需求删除、窄屏证据抽屉、批量录入时的重复提示。
- `CHANGELOG`。

## 已知限制

- PGlite 同一时间只允许一个进程打开数据目录。服务运行时 `npm run doctor` 会跳过数据库检查；`access:reset` 不访问数据库，可以随时运行。
- 字符偏移按 UTF-16 码元计算；字符上限按码点计算。
- `npm audit` 报告的中危问题都在开发依赖中（vitest、drizzle-kit 内部的 esbuild）。

## 参与

见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。安全问题请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 私下报告。

## 许可证

[AGPL-3.0-only](LICENSE)。你可以自由使用、修改和部署；如果把修改后的版本作为网络服务提供给他人，需要向这些用户提供对应的源代码。第三方依赖见 [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)。
