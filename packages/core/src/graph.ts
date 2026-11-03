// Deterministic impact query over confirmed local memory (PRD F07 "图查询规则").
//
// Default direction: when node B changes, find the nodes A that hold an edge
// A -[depends_on|calls|reads|writes]-> B. Only confirmed, valid edges propagate.
// `contains` and `owned_by` never propagate. Reaching a limit is reported as
// truncation; the result never claims "no other impact".

import type { EdgeType, Lang, SystemEdge, SystemNode } from "./types";

export const PROPAGATING_EDGE_TYPES: ReadonlySet<EdgeType> = new Set(["depends_on", "calls", "reads", "writes"]);

export const DEFAULT_MAX_DEPTH = 2;
export const DEFAULT_MAX_NODES = 100;
/** Per-node cap on listed paths so dense graphs stay readable. Counted, not dropped silently. */
export const MAX_PATHS_PER_NODE = 10;

export interface ImpactQueryOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface ImpactHit {
  nodeId: string;
  depth: number;
  relation: "direct" | "indirect";
  /** Each path lists edge ids from this node toward a changed node. Shortest paths only. */
  paths: string[][];
  /** True when more shortest paths existed than MAX_PATHS_PER_NODE. */
  pathsTruncated: boolean;
}

export type SkipReason = "not_confirmed" | "not_valid" | "non_propagating";

export interface SkippedEdge {
  edgeId: string;
  reason: SkipReason;
}

export interface ImpactResult {
  /** Changed nodes, listed separately and never counted as impacted. */
  changedNodeIds: string[];
  hits: ImpactHit[];
  truncation: {
    /** Nodes one hop past maxDepth that would have been reached. */
    beyondDepthNodeIds: string[];
    /** Nodes left out because maxNodes was reached. */
    overNodeLimitNodeIds: string[];
  };
  /** Edges pointing into the explored set that were not used, for the unknowns section. */
  skippedEdges: SkippedEdge[];
  options: Required<ImpactQueryOptions>;
}

export class UnknownNodeError extends Error {
  constructor(readonly nodeIds: string[]) {
    super(`unknown start node(s): ${nodeIds.join(", ")}`);
  }
}

function skipReason(edge: SystemEdge): SkipReason | null {
  if (!PROPAGATING_EDGE_TYPES.has(edge.type)) return "non_propagating";
  if (edge.confirmation !== "confirmed") return "not_confirmed";
  if (edge.validity !== "valid") return "not_valid";
  return null;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function impactQuery(
  nodes: readonly SystemNode[],
  edges: readonly SystemEdge[],
  startNodeIds: readonly string[],
  options: ImpactQueryOptions = {},
): ImpactResult {
  const opts = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
  };
  const nodeIds = new Set(nodes.map((n) => n.id));
  const starts = [...new Set(startNodeIds)].sort();
  const missing = starts.filter((id) => !nodeIds.has(id));
  if (missing.length) throw new UnknownNodeError(missing);

  // Incoming index: target -> edges whose `from` is impacted when target changes.
  const incoming = new Map<string, SystemEdge[]>();
  for (const e of [...edges].sort(byId)) {
    if (e.from === e.to) continue;
    const list = incoming.get(e.to) ?? [];
    list.push(e);
    incoming.set(e.to, list);
  }

  const depthOf = new Map<string, number>(starts.map((id) => [id, 0]));
  const paths = new Map<string, string[][]>(starts.map((id) => [id, [[]]]));
  const pathsTruncated = new Set<string>();
  const hits: string[] = [];
  const overLimit = new Set<string>();
  const skipped = new Map<string, SkipReason>();

  let frontier = starts;
  for (let depth = 1; depth <= opts.maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const target of frontier) {
      for (const edge of incoming.get(target) ?? []) {
        const reason = skipReason(edge);
        if (reason) {
          skipped.set(edge.id, reason);
          continue;
        }
        const node = edge.from;
        const known = depthOf.get(node);
        if (known !== undefined && known < depth) continue; // already reached by a shorter route (covers cycles)
        if (known === undefined) {
          if (hits.length >= opts.maxNodes) {
            overLimit.add(node);
            continue;
          }
          depthOf.set(node, depth);
          paths.set(node, []);
          hits.push(node);
          next.push(node);
        }
        const own = paths.get(node)!;
        for (const tail of paths.get(target)!) {
          if (own.length >= MAX_PATHS_PER_NODE) {
            pathsTruncated.add(node);
            break;
          }
          own.push([edge.id, ...tail]);
        }
        if (pathsTruncated.has(target)) pathsTruncated.add(node);
      }
    }
    frontier = next.sort();
  }

  // Anything one more hop out is reported, not silently dropped.
  const beyond = new Set<string>();
  for (const target of frontier) {
    for (const edge of incoming.get(target) ?? []) {
      const reason = skipReason(edge);
      if (reason) skipped.set(edge.id, reason);
      else if (!depthOf.has(edge.from)) beyond.add(edge.from);
    }
  }

  return {
    changedNodeIds: starts,
    hits: hits
      .map((nodeId) => {
        const depth = depthOf.get(nodeId)!;
        return {
          nodeId,
          depth,
          relation: depth === 1 ? ("direct" as const) : ("indirect" as const),
          paths: paths.get(nodeId)!,
          pathsTruncated: pathsTruncated.has(nodeId),
        };
      })
      .sort((a, b) => a.depth - b.depth || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)),
    truncation: {
      beyondDepthNodeIds: [...beyond].sort(),
      overNodeLimitNodeIds: [...overLimit].sort(),
    },
    skippedEdges: [...skipped].map(([edgeId, reason]) => ({ edgeId, reason })).sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1)),
    options: opts,
  };
}

export function isTruncated(result: ImpactResult): boolean {
  return result.truncation.beyondDepthNodeIds.length > 0 || result.truncation.overNodeLimitNodeIds.length > 0;
}

const VERBS: Record<Lang, Partial<Record<EdgeType, string>>> = {
  zh: { depends_on: "依赖", calls: "调用", reads: "读取", writes: "写入" },
  en: { depends_on: "depends on", calls: "calls", reads: "reads", writes: "writes" },
};

/**
 * A question to put to the owner of an impacted node. Phrased as something to
 * verify, because a dependency does not mean the node must change (F07).
 */
export function verificationQuestion(
  hit: ImpactHit,
  nodesById: ReadonlyMap<string, SystemNode>,
  edgesById: ReadonlyMap<string, SystemEdge>,
  lang: Lang,
): string {
  const path = hit.paths[0] ?? [];
  const first = edgesById.get(path[0] ?? "");
  const changed = edgesById.get(path[path.length - 1] ?? "");
  const name = (id: string | undefined) => (id && nodesById.get(id)?.name) || id || "?";
  const subject = name(hit.nodeId);
  const changedName = name(changed?.to);
  const verb = first ? VERBS[lang][first.type] ?? first.type : "";
  const via = name(first?.to);
  if (lang === "zh") {
    return hit.relation === "direct"
      ? `${subject}${verb}${via}：${changedName}变更后，${subject}的行为、接口约定或测试是否需要调整？`
      : `${subject}经由${via}间接依赖${changedName}：该变更是否会传导到${subject}？请确认是否需要回归验证。`;
  }
  return hit.relation === "direct"
    ? `${subject} ${verb} ${via}: after ${changedName} changes, do ${subject}'s behaviour, contract or tests need adjusting?`
    : `${subject} indirectly depends on ${changedName} via ${via}: does the change propagate to ${subject}? Confirm whether regression checks are needed.`;
}

export interface MergePreview {
  /** Edges whose endpoint moves from the merged node to the surviving node. */
  redirected: { edgeId: string; from: string; to: string }[];
  /** Edges that would become duplicates of an existing edge and are dropped. */
  duplicates: { edgeId: string; duplicateOf: string }[];
  /** Edges that would point a node at itself and are dropped. */
  selfLoops: string[];
  /** Names the surviving node keeps as aliases; the old id maps to the survivor. */
  aliases: string[];
  idMapping: { from: string; to: string };
}

/** Preview of merging `fromId` into `intoId` (F05). Applying it must leave no dangling references. */
export function previewNodeMerge(
  nodes: readonly SystemNode[],
  edges: readonly SystemEdge[],
  fromId: string,
  intoId: string,
): MergePreview {
  const from = nodes.find((n) => n.id === fromId);
  const into = nodes.find((n) => n.id === intoId);
  if (!from || !into) throw new UnknownNodeError([!from ? fromId : intoId]);
  if (from.productId !== into.productId) throw new Error("cannot merge nodes from different products");
  if (fromId === intoId) throw new Error("cannot merge a node into itself");

  const key = (e: { from: string; to: string; type: EdgeType }) => `${e.from}\u0000${e.to}\u0000${e.type}`;
  const kept = new Map<string, string>();
  for (const e of [...edges].sort(byId)) {
    if (e.from !== fromId && e.to !== fromId && !kept.has(key(e))) kept.set(key(e), e.id);
  }

  const preview: MergePreview = {
    redirected: [],
    duplicates: [],
    selfLoops: [],
    aliases: [...new Set([from.name, ...(from.aliases ?? [])])].filter((a) => a !== into.name),
    idMapping: { from: fromId, to: intoId },
  };
  for (const e of [...edges].sort(byId)) {
    if (e.from !== fromId && e.to !== fromId) continue;
    const moved = { from: e.from === fromId ? intoId : e.from, to: e.to === fromId ? intoId : e.to, type: e.type };
    if (moved.from === moved.to) {
      preview.selfLoops.push(e.id);
      continue;
    }
    const existing = kept.get(key(moved));
    if (existing) {
      preview.duplicates.push({ edgeId: e.id, duplicateOf: existing });
      continue;
    }
    kept.set(key(moved), e.id);
    preview.redirected.push({ edgeId: e.id, from: moved.from, to: moved.to });
  }
  return preview;
}
