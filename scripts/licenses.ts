// Writes docs/THIRD_PARTY_LICENSES.md from the installed production dependency
// tree. Run `npm run licenses` after changing dependencies; `--check` fails if
// the file is out of date or a license needs review.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = "docs/THIRD_PARTY_LICENSES.md";
// Compatible with distributing this project under AGPL-3.0-only.
const ACCEPTED = /^(MIT|ISC|0BSD|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|CC-BY-4\.0|CC0-1\.0|Unlicense|BlueOak-1\.0\.0|MPL-2\.0|LGPL-3\.0-or-later|Python-2\.0)$/;

interface Pkg {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  repository?: string | { url?: string };
  private?: boolean;
}

const paths = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\n")
  .filter((p) => p.includes("/node_modules/"));

const rows = new Map<string, { name: string; version: string; license: string; repo: string }>();
for (const path of paths) {
  const file = join(path, "package.json");
  if (!existsSync(file)) continue;
  const p = JSON.parse(readFileSync(file, "utf8")) as Pkg;
  if (p.private || p.name.startsWith("@pew/")) continue;
  const license = typeof p.license === "string" ? p.license : (p.license?.type ?? p.licenses?.map((l) => l.type).join(" OR ") ?? "UNKNOWN");
  const url = typeof p.repository === "string" ? p.repository : (p.repository?.url ?? "");
  const repo = url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:/, "https:").replace(/^github:/, "https://github.com/");
  rows.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, license, repo });
}

const sorted = [...rows.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
const parts = (l: string) => l.replace(/[()]/g, "").split(/\s+(?:AND|OR)\s+/);
const review = sorted.filter((r) => parts(r.license).some((l) => !ACCEPTED.test(l)));
const counts = new Map<string, number>();
for (const r of sorted) counts.set(r.license, (counts.get(r.license) ?? 0) + 1);

const doc = [
  "# 第三方依赖许可清单",
  "",
  "本项目以 AGPL-3.0-only 发布。下表列出生产运行时安装的依赖，由 `npm run licenses` 根据实际安装结果生成，请勿手工修改。开发工具（测试、类型检查、迁移生成）不随应用分发，未列入。",
  "",
  "许可证以各依赖 `package.json` 的声明为准；各依赖的完整许可文本随其包分发。",
  "",
  "## 汇总",
  "",
  "| 许可证 | 数量 |",
  "| --- | --- |",
  ...[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`),
  "",
  "## 明细",
  "",
  "| 依赖 | 版本 | 许可证 | 仓库 |",
  "| --- | --- | --- | --- |",
  ...sorted.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.repo} |`),
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== doc) {
    console.error(`${OUTPUT} is out of date: run npm run licenses`);
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT, doc);
  console.log(`${OUTPUT}: ${sorted.length} packages`);
}
if (review.length) {
  console.error("Licenses needing review:");
  for (const r of review) console.error(`  ${r.name}@${r.version}: ${r.license}`);
  process.exit(1);
}
