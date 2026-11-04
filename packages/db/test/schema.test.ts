// Applies the generated migrations to an in-process Postgres (PGlite) and
// checks the constraints that guard product ownership and lifecycle rules.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "../../../migrations");
let db: PGlite;

async function exec(sql: string) {
  return db.exec(sql);
}

beforeAll(async () => {
  db = new PGlite();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await db.exec(statement);
    }
  }
  await exec(`
    INSERT INTO products (id, name) VALUES ('pA', 'A'), ('pB', 'B');
    INSERT INTO sources (id, product_id, kind, name) VALUES ('sA', 'pA', 'paste', 'rules A'), ('sB', 'pB', 'paste', 'rules B');
    INSERT INTO source_versions (id, product_id, source_id, version, text, content_hash, char_count)
      VALUES ('svA', 'pA', 'sA', 1, '仅本人。', 'h', 4), ('svB', 'pB', 'sB', 1, '团队。', 'h', 3);
    INSERT INTO evidences (id, product_id, source_version_id, char_start, char_end, line_start, line_end, quote, quote_hash)
      VALUES ('evA', 'pA', 'svA', 0, 3, 1, 1, '仅本人', 'h'), ('evB', 'pB', 'svB', 0, 2, 1, 1, '团队', 'h');
    INSERT INTO analyses (id, product_id, title) VALUES ('aA', 'pA', 'export');
    INSERT INTO analysis_runs (id, product_id, analysis_id, task_type, idempotency_key, input_snapshot)
      VALUES ('rA', 'pA', 'aA', 'abstraction', 'key-1', '{}');
    INSERT INTO claims (id, product_id, run_id, position, section, kind, text) VALUES ('cA', 'pA', 'rA', 0, 'risk', 'source_fact', 'x');
    INSERT INTO system_nodes (id, product_id, type, name) VALUES ('nA1', 'pA', 'module', 'export'), ('nA2', 'pA', 'module', 'perm'), ('nB1', 'pB', 'module', 'other');
  `);
});

describe("product ownership is enforced by the database", () => {
  it("rejects a claim citing another product's evidence", async () => {
    await expect(exec(`INSERT INTO claim_evidences (product_id, claim_id, evidence_id, position) VALUES ('pA', 'cA', 'evB', 0)`)).rejects.toThrow(
      /claim_evidences_evidence_fk/,
    );
    await exec(`INSERT INTO claim_evidences (product_id, claim_id, evidence_id, position) VALUES ('pA', 'cA', 'evA', 0)`);
  });

  it("rejects an edge between nodes of different products", async () => {
    await expect(
      exec(`INSERT INTO system_edges (id, product_id, from_node_id, to_node_id, type) VALUES ('eX', 'pA', 'nA1', 'nB1', 'calls')`),
    ).rejects.toThrow(/system_edges_to_fk/);
  });

  it("rejects selecting another product's source version for an analysis", async () => {
    await expect(exec(`INSERT INTO analysis_sources (product_id, analysis_id, source_version_id) VALUES ('pA', 'aA', 'svB')`)).rejects.toThrow(
      /analysis_sources_version_fk/,
    );
  });

  it("deleting a product removes everything it owns and nothing else", async () => {
    await exec(`DELETE FROM products WHERE id = 'pB'`);
    const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM evidences WHERE product_id = 'pB'`);
    const kept = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM evidences WHERE product_id = 'pA'`);
    expect([left.rows[0]!.n, kept.rows[0]!.n]).toEqual([0, 1]);
  });
});

describe("lifecycle constraints", () => {
  it("a confirmed edge must record its basis and confirmation time", async () => {
    await expect(
      exec(`INSERT INTO system_edges (id, product_id, from_node_id, to_node_id, type, confirmation) VALUES ('e1', 'pA', 'nA1', 'nA2', 'calls', 'confirmed')`),
    ).rejects.toThrow(/system_edges_confirmed_basis/);
    await exec(
      `INSERT INTO system_edges (id, product_id, from_node_id, to_node_id, type, confirmation, basis, confirmed_at) VALUES ('e1', 'pA', 'nA1', 'nA2', 'calls', 'confirmed', 'user_asserted', now())`,
    );
  });

  it("refuses self-loop edges", async () => {
    await expect(
      exec(`INSERT INTO system_edges (id, product_id, from_node_id, to_node_id, type) VALUES ('e2', 'pA', 'nA1', 'nA1', 'calls')`),
    ).rejects.toThrow(/system_edges_no_self_loop/);
  });

  it("a deleted source version keeps no text, and a live one must keep it", async () => {
    await expect(exec(`UPDATE source_versions SET validity = 'source_deleted' WHERE id = 'svA'`)).rejects.toThrow(/source_versions_content/);
    await expect(exec(`UPDATE source_versions SET text = NULL WHERE id = 'svA'`)).rejects.toThrow(/source_versions_content/);
  });

  it("the same idempotency key cannot create a second run", async () => {
    await expect(
      exec(`INSERT INTO analysis_runs (id, product_id, analysis_id, task_type, idempotency_key, input_snapshot) VALUES ('rA2', 'pA', 'aA', 'abstraction', 'key-1', '{}')`),
    ).rejects.toThrow(/analysis_runs_idempotency_uq/);
  });

  it("a rejected claim needs a reason, and only rejected claims carry one", async () => {
    await expect(exec(`UPDATE claims SET review = 'rejected' WHERE id = 'cA'`)).rejects.toThrow(/claims_reject_reason/);
    await exec(`UPDATE claims SET review = 'rejected', reject_reason = 'citation_not_supporting' WHERE id = 'cA'`);
  });

  it("decisions require a reason", async () => {
    await expect(exec(`INSERT INTO decisions (id, product_id, content, reason, decided_at) VALUES ('d1', 'pA', 'merge', '  ', now())`)).rejects.toThrow(
      /decisions_reason_present/,
    );
  });

  it("the instance can only be initialized once", async () => {
    await exec(`INSERT INTO instance_state (access_credential_hash) VALUES ('h1')`);
    await expect(exec(`INSERT INTO instance_state (access_credential_hash) VALUES ('h2')`)).rejects.toThrow(/instance_state_pkey/);
    await expect(exec(`INSERT INTO instance_state (singleton, access_credential_hash) VALUES (false, 'h3')`)).rejects.toThrow(/instance_state_singleton/);
  });
});
