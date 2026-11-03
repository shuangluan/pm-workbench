// Shared domain vocabulary (PRD §3, §5 F05, §7.3).

/** What a claim is. Independent from how the user handled it (§3.2). */
export type ClaimKind =
  | "source_fact"
  | "confirmed_relation"
  | "inference"
  | "suggestion"
  | "unknown";

/** How the user handled a claim. Accepting never upgrades a claim's kind. */
export type ReviewStatus = "pending" | "accepted" | "corrected" | "rejected";

export type RejectReason =
  | "factually_wrong"
  | "citation_not_supporting"
  | "duplicate"
  | "irrelevant"
  | "missing_material"
  | "other";

/** Whether the cited material is still current. Separate from ReviewStatus. */
export type EvidenceValidity = "valid" | "needs_review" | "source_deleted";

export type NodeType = "module" | "interface" | "data_object" | "role" | "business_party";

export type EdgeType = "depends_on" | "calls" | "reads" | "writes" | "contains" | "owned_by";

export type EdgeConfirmation = "candidate" | "confirmed" | "rejected";

/** Where a confirmed edge's backing came from. */
export type EdgeBasis = "document" | "user_asserted";

export type MemoryValidity = "valid" | "needs_review" | "obsolete";

export interface SystemNode {
  id: string;
  productId: string;
  type: NodeType;
  name: string;
  aliases?: string[];
}

export interface SystemEdge {
  id: string;
  productId: string;
  /** Edge reads "from <type> to": the export module (from) calls the permission service (to). */
  from: string;
  to: string;
  type: EdgeType;
  confirmation: EdgeConfirmation;
  validity: MemoryValidity;
  basis?: EdgeBasis;
  evidenceIds?: string[];
  confirmedAt?: string;
}

export type Lang = "zh" | "en";
