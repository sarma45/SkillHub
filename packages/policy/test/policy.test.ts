import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  TransitionError,
  noDirectDraftIntegration,
  isCapabilityEnabled,
  assertCapabilityEnabled,
  CapabilityDisabledError,
  assertScopes,
  ScopeDeniedError,
  hasScopes,
  planHash,
  canonicalJson,
  redactSecrets,
  containsSecret,
  isSensitivePath,
  ROLE_SCOPES,
} from "../src/index.js";

describe("state machine", () => {
  it("allows the happy path DRAFT -> FRAMED -> PLANNED -> AWAITING_PLAN_APPROVAL", () => {
    expect(canTransition("DRAFT", "FRAMED", "user").ok).toBe(true);
    expect(
      canTransition("FRAMED", "PLANNED", "agent", { evidence_complete: false }).ok
    ).toBe(true); // requires_evidence is enforced by callers journaling docs
    expect(canTransition("PLANNED", "AWAITING_PLAN_APPROVAL", "agent").ok).toBe(true);
  });

  it("requires the plan-hash guard for approval -> executing", () => {
    expect(
      canTransition("AWAITING_PLAN_APPROVAL", "EXECUTING", "user").ok
    ).toBe(false);
    expect(
      canTransition("AWAITING_PLAN_APPROVAL", "EXECUTING", "user", {
        plan_hash_current: true,
      }).ok
    ).toBe(true);
  });

  it("rejects DRAFT -> INTEGRATED outright (master prompt invariant)", () => {
    expect(canTransition("DRAFT", "INTEGRATED", "user").ok).toBe(false);
    expect(canTransition("DRAFT", "AWAITING_INTEGRATION_APPROVAL", "user").ok).toBe(false);
    expect(noDirectDraftIntegration("DRAFT", "INTEGRATED")).toBe(false);
  });

  it("rejects illegal actor", () => {
    expect(canTransition("DRAFT", "FRAMED", "agent").ok).toBe(false);
  });

  it("allows pause/resume/cancel from EXECUTING by the user", () => {
    expect(canTransition("EXECUTING", "PAUSED_FOR_HUMAN", "user").ok).toBe(true);
    expect(canTransition("PAUSED_FOR_HUMAN", "EXECUTING", "user").ok).toBe(true);
    expect(canTransition("EXECUTING", "CANCELLED", "user").ok).toBe(true);
  });

  it("rejects unknown transitions like FRAMED -> INTEGRATED", () => {
    expect(canTransition("FRAMED", "INTEGRATED", "user").ok).toBe(false);
  });

  it("assertTransition throws TransitionError with reason", () => {
    expect(() => assertTransition("INTEGRATED", "EXECUTING", "user")).toThrow(
      TransitionError
    );
  });

  it("verifying -> ready_for_review requires evidence_complete guard", () => {
    expect(canTransition("VERIFYING", "READY_FOR_REVIEW", "evaluator").ok).toBe(false);
    expect(
      canTransition("VERIFYING", "READY_FOR_REVIEW", "evaluator", {
        evidence_complete: true,
      }).ok
    ).toBe(true);
  });
});

describe("capability flags", () => {
  it("enables MVP capabilities only", () => {
    expect(isCapabilityEnabled("run.execute")).toBe(true);
    expect(isCapabilityEnabled("security.local_fixture_scan")).toBe(true);
  });

  it("keeps dormant capabilities off and enforced by assert", () => {
    expect(isCapabilityEnabled("integration.github_submit")).toBe(false);
    expect(isCapabilityEnabled("decision.jev")).toBe(false);
    expect(() => assertCapabilityEnabled("integration.github_submit")).toThrow(
      CapabilityDisabledError
    );
    expect(() => assertCapabilityEnabled("run.execute")).not.toThrow();
  });

  it("Phase 4+ features are now ACTIVE capabilities (memory/context/browser/autonomous)", () => {
    expect(isCapabilityEnabled("memory.service")).toBe(true);
    expect(isCapabilityEnabled("context.bundle")).toBe(true);
    expect(isCapabilityEnabled("browser.verify")).toBe(true);
    expect(isCapabilityEnabled("run.autonomous")).toBe(true);
  });
});

describe("tool scopes", () => {
  it("is deny-by-default", () => {
    expect(hasScopes([], ["workspace:write"])).toBe(false);
    expect(hasScopes(["workspace:write"], ["workspace:write"])).toBe(true);
  });

  it("reviewer role cannot execute runs", () => {
    expect(hasScopes(ROLE_SCOPES.reviewer, ["run:execute"])).toBe(false);
    expect(() => assertScopes(ROLE_SCOPES.reviewer, ["run:execute"])).toThrow(
      ScopeDeniedError
    );
  });

  it("engineer can edit workspace but not security-scan", () => {
    expect(hasScopes(ROLE_SCOPES.engineer, ["workspace:write"])).toBe(true);
    expect(hasScopes(ROLE_SCOPES.engineer, ["security:scan"])).toBe(false);
  });
});

describe("plan hashing", () => {
  it("is key-order independent and stable", () => {
    const a = { goal: "g", steps: [{ id: "s1", tools: ["read_file"] }] };
    const b = { steps: [{ tools: ["read_file"], id: "s1" }], goal: "g" };
    expect(planHash(a)).toBe(planHash(b));
    expect(planHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("changes when content changes", () => {
    const a = { goal: "g1" };
    const b = { goal: "g2" };
    expect(planHash(a)).not.toBe(planHash(b));
  });
});

describe("redaction", () => {
  it("redacts common secret shapes", () => {
    const input = [
      "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AWS key AKIAIOSFODNN7EXAMPLE",
      "api_key = 'hunter2secret'",
      "Authorization: Bearer abc.def.ghi-jkl012345",
    ].join("\n");
    const out = redactSecrets(input);
    expect(out.changed).toBe(true);
    expect(out.redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(out.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out.redacted).not.toContain("hunter2secret");
    expect(out.redacted).toContain("[REDACTED]");
    expect(out.summary.length).toBeGreaterThanOrEqual(3);
  });

  it("detects private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----";
    expect(containsSecret(pem)).toBe(true);
    const out = redactSecrets(pem);
    expect(out.redacted).not.toContain("MIIEow");
  });

  it("leaves clean text untouched", () => {
    const clean = "export function add(a: number, b: number) { return a + b; }";
    const out = redactSecrets(clean);
    expect(out.changed).toBe(false);
    expect(out.redacted).toBe(clean);
  });

  it("flags sensitive paths", () => {
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath("config/credentials.json")).toBe(true);
    expect(isSensitivePath("src/index.ts")).toBe(false);
  });
});
