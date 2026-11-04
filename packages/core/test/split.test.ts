import { describe, expect, it } from "vitest";
import { MAX_SPLIT_CANDIDATES, parseCsv, splitRequests, splitTable } from "@pew/core";

describe("splitRequests", () => {
  it("reads a pasted spreadsheet with a header row", () => {
    const r = splitRequests("业务方\t标题\t需求描述\n运营\t导出筛选\t导出当前筛选结果\n客服\t导出工单客户\t不得包含手机号\n");
    expect(r.mode).toBe("table");
    expect(r.columns).toEqual({ party: 0, title: 1, text: 2 });
    expect(r.candidates).toEqual([
      { party: "运营", title: "导出筛选", text: "导出当前筛选结果" },
      { party: "客服", title: "导出工单客户", text: "不得包含手机号" },
    ]);
  });

  it("reads a two-column paste without header as party + text", () => {
    const r = splitRequests("运营\t导出筛选结果\n销售\t导出团队客户");
    expect(r.candidates.map((c) => [c.party, c.text])).toEqual([
      ["运营", "导出筛选结果"],
      ["销售", "导出团队客户"],
    ]);
  });

  it("splits '业务方：原话' lines and keeps continuation lines with their request", () => {
    const r = splitRequests("运营：导出当前筛选结果，供每周处理。\n只需自己有权查看的客户。\n销售(华东)：导出整个团队的客户。\n客服: 不得包含手机号");
    expect(r.mode).toBe("speaker");
    expect(r.candidates).toEqual([
      { party: "运营", title: null, text: "导出当前筛选结果，供每周处理。\n只需自己有权查看的客户。" },
      { party: "销售(华东)", title: null, text: "导出整个团队的客户。" },
      { party: "客服", title: null, text: "不得包含手机号" },
    ]);
  });

  it("splits a chat export by speaker and merges consecutive messages", () => {
    const chat = ["王运营 10:02", "能不能导出筛选结果？", "王运营 10:03", "每周要用", "李销售 2026-11-01 10:05", "我们要导出整个团队的客户"].join("\n");
    const r = splitRequests(chat);
    expect(r.mode).toBe("speaker");
    expect(r.candidates).toEqual([
      { party: "王运营", title: null, text: "能不能导出筛选结果？\n每周要用" },
      { party: "李销售", title: null, text: "我们要导出整个团队的客户" },
    ]);
  });

  it("keeps the PM's own clarifying question and the answer with the request", () => {
    const r = splitRequests("赵财务：导出时要能带上合同金额\n我：所有角色都要吗？\n赵财务：只给财务和管理层\n孙法务：导出要留审计记录");
    expect(r.candidates).toEqual([
      { party: "赵财务", title: null, text: "赵财务：导出时要能带上合同金额\n我：所有角色都要吗？\n赵财务：只给财务和管理层" },
      { party: "孙法务", title: null, text: "导出要留审计记录" },
    ]);
  });

  it("splits numbered lists and picks up a party prefix inside an item", () => {
    const r = splitRequests("1. 运营：导出筛选结果\n2、销售希望导出团队客户\n   用于季度跟进\n3) 客服：不要手机号");
    expect(r.mode).toBe("list");
    expect(r.candidates).toEqual([
      { party: "运营", title: null, text: "导出筛选结果" },
      { party: null, title: null, text: "销售希望导出团队客户\n用于季度跟进" },
      { party: "客服", title: null, text: "不要手机号" },
    ]);
  });

  it("falls back to blank-line paragraphs", () => {
    const r = splitRequests("希望导出筛选结果。\n\n\n希望导出团队客户。");
    expect(r.mode).toBe("paragraph");
    expect(r.candidates.map((c) => c.text)).toEqual(["希望导出筛选结果。", "希望导出团队客户。"]);
  });

  it("does not treat a sentence with a colon in the middle as a party prefix", () => {
    const r = splitRequests("注意，导出时间：每周一。\n\n另一个需求");
    expect(r.candidates[0]!.party).toBeNull();
  });

  it("caps the number of candidates and says so", () => {
    const r = splitRequests(Array.from({ length: MAX_SPLIT_CANDIDATES + 5 }, (_, i) => `需求 ${i}`).join("\n\n"));
    expect(r.candidates).toHaveLength(MAX_SPLIT_CANDIDATES);
    expect(r.truncated).toBe(true);
  });
});

describe("CSV", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('业务方,原话\r\n运营,"导出筛选结果, 每周"\n客服,"说""不要""手机号\n第二行"\n');
    expect(rows).toEqual([
      ["业务方", "原话"],
      ["运营", "导出筛选结果, 每周"],
      ["客服", '说"不要"手机号\n第二行'],
    ]);
    expect(splitTable(rows).candidates.map((c) => c.party)).toEqual(["运营", "客服"]);
  });
});
