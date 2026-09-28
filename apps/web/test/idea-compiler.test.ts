/**
 * Idea compiler (idea → CreateTaskRequest) — deterministic compiler tests.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { CreateTaskRequest } from "@cockpit/contracts";
import { compileIdeaToBrief, deriveRisk, deriveDomain, extractTitle } from "../src/lib/idea-compiler";

const IDEA = `A booking dashboard for a small dental clinic.
Users can see today's appointments and confirm them with one click.
The system sends a confirmation email to the patient.
Do not support online payments.`;

describe("idea compiler: contract compliance", () => {
  it("output passes the real CreateTaskRequest schema", () => {
    const { brief } = compileIdeaToBrief(IDEA);
    expect(() => CreateTaskRequest.parse(brief)).not.toThrow();
  });

  it("keeps the request text verbatim (trimmed)", () => {
    const { brief } = compileIdeaToBrief(`   ${IDEA}   `);
    expect(brief.request).toBe(IDEA);
  });

  it("rejects ideas below the contract minimum (8 chars)", () => {
    expect(() => compileIdeaToBrief("short")).toThrow(/8 characters/);
  });
});

describe("idea compiler: determinism", () => {
  it("same input ⇒ byte-identical output", () => {
    const a = compileIdeaToBrief(IDEA);
    const b = compileIdeaToBrief(IDEA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("idea compiler: risk classification", () => {
  it("high: payments/auth/production keywords", () => {
    expect(deriveRisk("Add payment processing with Stripe").risk).toBe("high");
    expect(deriveRisk("Add password reset flow").risk).toBe("high");
    expect(deriveRisk("Run a database migration").risk).toBe("high");
  });
  it("medium: integrations and user data", () => {
    expect(deriveRisk("Send confirmation email via webhook").risk).toBe("medium");
    expect(deriveRisk("Store user data locally").risk).toBe("medium");
  });
  it("low otherwise, and never auto-escalates to critical", () => {
    expect(deriveRisk("A static page listing clinic hours").risk).toBe("low");
    for (const idea of ["payment flow", "auth", "delete everything"]) {
      expect(deriveRisk(idea).risk).not.toBe("critical");
    }
  });
});

describe("idea compiler: field derivation", () => {
  it("extracts actionable sentences as success criteria", () => {
    const { brief } = compileIdeaToBrief(IDEA);
    expect(brief.success_criteria.some((c) => /confirm them with one click/.test(c))).toBe(true);
    expect(brief.success_criteria.some((c) => /confirmation email/.test(c))).toBe(true);
  });

  it("extracts exclusions as non-goals", () => {
    const { brief } = compileIdeaToBrief(IDEA);
    expect(brief.non_goals.some((n) => /payments/i.test(n))).toBe(true);
  });

  it("falls back to safe defaults when nothing actionable is stated", () => {
    const { brief } = compileIdeaToBrief("Renovate the onboarding copy across screens");
    expect(brief.success_criteria).toHaveLength(1);
    expect(brief.non_goals).toHaveLength(1);
  });

  it("classifies domain from hints", () => {
    expect(deriveDomain(IDEA)).toBe("web-app");
    expect(deriveDomain("A cron job that emails reports")).toBe("automation");
    expect(deriveDomain("Something for the clinic")).toBe("general");
  });

  it("truncates long titles with an ellipsis (60 chars incl. ellipsis)", () => {
    const t = extractTitle("A".repeat(100));
    expect(t.length).toBe(60);
    expect(t.endsWith("…")).toBe(true);
  });

  it("caps success criteria at the contract maximum (10)", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Users can do thing ${i}.`).join(" ");
    const { brief } = compileIdeaToBrief(long);
    expect(brief.success_criteria.length).toBeLessThanOrEqual(10);
    expect(() => CreateTaskRequest.parse(brief)).not.toThrow();
  });
});
