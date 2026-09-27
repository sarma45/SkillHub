import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, seed } from "@cockpit/db";
import { routeProvider, listProviders, routeAndRecord, PROVIDER_CATALOG } from "../src/index.js";

let db: ReturnType<typeof openDb>;
beforeAll(() => {
  db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "route-")), "t.db"));
  seed(db);
  // decisions.project_id references projects(id); insert the fixture project
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO projects (id, organization_id, name, source_type, source_ref, permission_mode, status, repository_map_json, map_version, created_at, updated_at) VALUES (?, ?, ?, 'fixture', 'sample-app', 'read_only', 'ready', NULL, 0, ?, ?)"
  ).run("proj_route", "org_local", "routing-fixture", now, now);
});
afterAll(() => db.close());

describe("provider catalog + routing policy", () => {
  it("lists the catalog with key presence", () => {
    const providers = listProviders({});
    expect(providers.length).toBeGreaterThanOrEqual(4);
    expect(providers.find((p) => p.id === "anthropic-claude-sonnet-4")?.key_present).toBe(false);
    expect(providers.find((p) => p.id === "mock-deterministic-v1")?.key_present).toBe(true);
  });

  it("routes to offline providers when no keys are set", () => {
    const d = routeProvider("planning", {});
    expect(["mock-deterministic-v1"]).toContain(d.provider_id);
    expect(d.reason).toContain("no key required");
  });

  it("routes tools purpose to a tool-capable adapter when a key exists", () => {
    const d = routeProvider("tools", { ANTHROPIC_API_KEY: "k" });
    expect(d.provider_id).toBe("anthropic-claude-sonnet-4");
    expect(d.adapter).toBe("anthropic");
  });

  it("prefers openai for fast purposes when only OPENAI key exists", () => {
    const d = routeProvider("planning", { OPENAI_API_KEY: "k" });
    expect(d.provider_id).toBe("openai-gpt-4o");
  });

  it("is deterministic: same inputs, same decision", () => {
    const env = { ANTHROPIC_API_KEY: "k" };
    expect(routeProvider("editing", env)).toEqual(routeProvider("editing", env));
  });

  it("every catalog entry has required metadata", () => {
    for (const p of PROVIDER_CATALOG) {
      expect(p.strengths.length).toBeGreaterThan(0);
      expect(p.cost).toBeGreaterThanOrEqual(1);
      expect(p.cost).toBeLessThanOrEqual(10);
      expect(["local", "cloud_us", "cloud_eu"]).toContain(p.privacy);
    }
  });

  it("routeAndRecord writes a durable decision receipt", () => {
    const { decision } = routeAndRecord(db, { projectId: "proj_route", purpose: "planning" });
    expect(decision.policy_version).toBeTruthy();
    const row = db
      .prepare("SELECT * FROM decisions WHERE project_id = 'proj_route' AND decision_kind = 'route' ORDER BY created_at DESC LIMIT 1")
      .get() as { answer_json: string; confidence: number } | undefined;
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.answer_json)).toHaveProperty("provider_id");
    expect(row!.confidence).toBe(1);
  });
});
