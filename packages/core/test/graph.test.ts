import { describe, expect, it } from "vitest";
import { impactQuery, isTruncated, previewNodeMerge, UnknownNodeError, type SystemEdge, type SystemNode } from "@pew/core";
import { edges as exampleEdges, nodes as exampleNodes } from "../../../examples/batch-export";

const P = "p1";
const node = (id: string): SystemNode => ({ id, productId: P, type: "module", name: id.toUpperCase() });
const edge = (id: string, from: string, to: string, type: SystemEdge["type"] = "depends_on", extra: Partial<SystemEdge> = {}): SystemEdge => ({
  id,
  productId: P,
  from,
  to,
  type,
  confirmation: "confirmed",
  validity: "valid",
  ...extra,
});

describe("impactQuery on the §10.3 example", () => {
  it("permission service change: export is direct, report is indirect", () => {
    const r = impactQuery(exampleNodes, exampleEdges, ["n_permission"]);
    expect(r.changedNodeIds).toEqual(["n_permission"]);
    expect(r.hits.map((h) => [h.nodeId, h.relation, h.depth])).toEqual([
      ["n_export", "direct", 1],
      ["n_report", "indirect", 2],
    ]);
    expect(r.hits[1]!.paths).toEqual([["e_report_depends_export", "e_export_calls_perm"]]);
    expect(isTruncated(r)).toBe(false);
  });

  it("export module change: report depends on it; permission service is not a downstream dependant", () => {
    const r = impactQuery(exampleNodes, exampleEdges, ["n_export"]);
    expect(r.hits.map((h) => h.nodeId)).toEqual(["n_report"]);
    expect(r.hits.map((h) => h.nodeId)).not.toContain("n_permission");
  });

  it("is deterministic regardless of input order", () => {
    const a = impactQuery(exampleNodes, exampleEdges, ["n_permission"]);
    const b = impactQuery([...exampleNodes].reverse(), [...exampleEdges].reverse(), ["n_permission"]);
    expect(b).toEqual(a);
  });
});

describe("impactQuery rules", () => {
  it("terminates on cycles and keeps the changed node out of hits", () => {
    const r = impactQuery([node("a"), node("b")], [edge("ab", "a", "b"), edge("ba", "b", "a")], ["b"]);
    expect(r.hits.map((h) => h.nodeId)).toEqual(["a"]);
    expect(r.hits[0]!.paths).toEqual([["ab"]]);
  });

  it("does not propagate unconfirmed, invalid, contains or owned_by edges, and reports them", () => {
    const nodes = ["t", "c", "o", "u", "x"].map(node);
    const edges = [
      edge("contains", "c", "t", "contains"),
      edge("owner", "o", "t", "owned_by"),
      edge("cand", "u", "t", "calls", { confirmation: "candidate" }),
      edge("stale", "x", "t", "reads", { validity: "needs_review" }),
    ];
    const r = impactQuery(nodes, edges, ["t"]);
    expect(r.hits).toEqual([]);
    expect(r.skippedEdges).toEqual([
      { edgeId: "cand", reason: "not_confirmed" },
      { edgeId: "contains", reason: "non_propagating" },
      { edgeId: "owner", reason: "non_propagating" },
      { edgeId: "stale", reason: "not_valid" },
    ]);
  });

  it("reports nodes beyond the depth limit instead of claiming nothing else is affected", () => {
    const nodes = ["a", "b", "c", "d"].map(node);
    const edges = [edge("ba", "b", "a"), edge("cb", "c", "b"), edge("dc", "d", "c")];
    const r = impactQuery(nodes, edges, ["a"]);
    expect(r.hits.map((h) => h.nodeId)).toEqual(["b", "c"]);
    expect(r.truncation.beyondDepthNodeIds).toEqual(["d"]);
    expect(isTruncated(r)).toBe(true);
  });

  it("stops at the node limit and lists what was left out", () => {
    const nodes = [node("root"), ...Array.from({ length: 5 }, (_, i) => node(`n${i}`))];
    const edges = Array.from({ length: 5 }, (_, i) => edge(`e${i}`, `n${i}`, "root"));
    const r = impactQuery(nodes, edges, ["root"], { maxNodes: 3 });
    expect(r.hits.map((h) => h.nodeId)).toEqual(["n0", "n1", "n2"]);
    expect(r.truncation.overNodeLimitNodeIds).toEqual(["n3", "n4"]);
  });

  it("keeps every shortest path when a node is reached more than one way", () => {
    const nodes = ["t", "m1", "m2", "top"].map(node);
    const edges = [edge("m1t", "m1", "t"), edge("m2t", "m2", "t"), edge("top1", "top", "m1"), edge("top2", "top", "m2")];
    const r = impactQuery(nodes, edges, ["t"]);
    const top = r.hits.find((h) => h.nodeId === "top")!;
    expect(top.depth).toBe(2);
    expect(top.paths).toEqual([["top1", "m1t"], ["top2", "m2t"]]);
  });

  it("uses the shorter route when a node is reachable at depth 1 and 2", () => {
    const nodes = ["t", "m", "a"].map(node);
    const r = impactQuery(nodes, [edge("at", "a", "t"), edge("mt", "m", "t"), edge("am", "a", "m")], ["t"]);
    expect(r.hits.find((h) => h.nodeId === "a")).toMatchObject({ depth: 1, relation: "direct", paths: [["at"]] });
  });

  it("rejects unknown start nodes", () => {
    expect(() => impactQuery([node("a")], [], ["missing"])).toThrow(UnknownNodeError);
  });
});

describe("previewNodeMerge", () => {
  it("redirects edges, drops duplicates and self-loops, keeps the old name as alias", () => {
    const nodes = [node("a"), node("a2"), node("b")];
    const edges = [edge("ab", "a", "b"), edge("a2b", "a2", "b"), edge("ba2", "b", "a2", "calls"), edge("a2a", "a2", "a")];
    const p = previewNodeMerge(nodes, edges, "a2", "a");
    expect(p.duplicates).toEqual([{ edgeId: "a2b", duplicateOf: "ab" }]);
    expect(p.redirected).toEqual([{ edgeId: "ba2", from: "b", to: "a" }]);
    expect(p.selfLoops).toEqual(["a2a"]);
    expect(p.aliases).toEqual(["A2"]);
    expect(p.idMapping).toEqual({ from: "a2", to: "a" });
  });

  it("refuses to merge across products", () => {
    expect(() => previewNodeMerge([node("a"), { ...node("b"), productId: "p2" }], [], "a", "b")).toThrow(/different products/);
  });
});
