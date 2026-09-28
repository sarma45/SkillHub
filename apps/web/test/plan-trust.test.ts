/**
 * Plan trust scorer tests — deterministic, contract-typed, explainable.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { PlanDocument } from "@cockpit/contracts";
import { scorePlan } from "../src/lib/plan-trust";

function makePlan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    goal: "Add a confirmation flow to the booking dashboard",
    success_criteria: ["Users can confirm appointments"],
    non_goals: ["No online payments"],
    assumptions: [],
    steps: [
      {
        id: "s1",
        title: "Confirm appointment endpoint",
        depends_on: [],
        tools: ["workspace_edit"],
        expected_outputs: ["src/app/api/confirm/route.ts"],
        verification: ["npm test"],
        affected_files: ["src/app/api/confirm/route.ts"],
        human_checkpoint: false,
      },
      {
        id: "s2",
        title: "Wire the confirm button",
        depends_on: ["s1"],
        tools: ["workspace_edit"],
        expected_outputs: ["components/confirm.tsx"],
        verification: ["manual check via browser_verify"],
        affected_files: ["components/confirm.tsx"],
        human_checkpoint: true,
      },
    ],
    risk: "medium",
    approval_points: ["Human approves plan"],
    budget: { max_cost_usd: 1, max_duration_ms: 600_000, max_retries: 2, max_tool_calls: 50 },
    ...overrides,
  };
}

describe("plan trust scorer", () => {
  it("scores a well-formed plan HIGH with full verification/specificity", () => {
    const t = scorePlan(makePlan());
    expect(t.overall).toBeGreaterThanOrEqual(85);
    expect(t.confidence).toBe("HIGH");
    const verification = t.components.find((c) => c.key === "verification")!;
    expect(verification.score).toBe(100);
    expect(verification.rule).toContain("2/2 steps");
  });

  it("penalizes steps without verification methods", () => {
    const plan = makePlan();
    plan.steps[0]!.verification = [];
    const t = scorePlan(plan);
    const verification = t.components.find((c) => c.key === "verification")!;
    expect(verification.score).toBe(50);
    expect(t.overall).toBeLessThan(scorePlan(makePlan()).overall);
  });

  it("penalizes vague steps (no outputs, no affected files)", () => {
    const plan = makePlan();
    plan.steps[1]!.expected_outputs = [];
    plan.steps[1]!.affected_files = [];
    const t = scorePlan(plan);
    expect(t.components.find((c) => c.key === "specificity")!.score).toBe(50);
  });

  it("rewards bounded budgets and punishes cap-pinned ones", () => {
    const generous = scorePlan(makePlan()).components.find((c) => c.key === "budget")!.score;
    const pinned = scorePlan(makePlan({ budget: { max_cost_usd: 1, max_duration_ms: 3_600_000, max_retries: 10, max_tool_calls: 1000 } }));
    expect(pinned.components.find((c) => c.key === "budget")!.score).toBe(0);
    expect(generous).toBeGreaterThan(50);
  });

  it("assumption score is the mean confidence; neutral when none stated", () => {
    expect(scorePlan(makePlan()).components.find((c) => c.key === "assumption")!.score).toBe(100);
    const withAssumptions = scorePlan(
      makePlan({
        assumptions: [
          { text: "npm test exists", confidence: 0.9, source: "repo map" },
          { text: "single-page UI", confidence: 0.7, source: "brief" },
        ],
      })
    );
    expect(withAssumptions.components.find((c) => c.key === "assumption")!.score).toBe(80);
  });

  it("human oversight caps at 2 credit points", () => {
    const many = scorePlan(makePlan({ approval_points: ["a", "b", "c"] }));
    expect(many.components.find((c) => c.key === "human")!.score).toBe(100);
    const none = scorePlan(makePlan({ approval_points: [], steps: makePlan().steps.map((s) => ({ ...s, human_checkpoint: false })) }));
    expect(none.components.find((c) => c.key === "human")!.score).toBe(0);
  });

  it("is deterministic: same plan, same score, byte-identical", () => {
    const plan = makePlan();
    expect(JSON.stringify(scorePlan(plan))).toBe(JSON.stringify(scorePlan(plan)));
  });

  it("component weights sum to 1 and overall stays within 0-100", () => {
    const t = scorePlan(makePlan());
    expect(t.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
    for (const c of t.components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
    expect(t.overall).toBeGreaterThanOrEqual(0);
    expect(t.overall).toBeLessThanOrEqual(100);
  });

  it("scores LOW for an unverifiable, vague, cap-pinned plan", () => {
    const vague = makePlan({
      budget: { max_cost_usd: 1, max_duration_ms: 3_600_000, max_retries: 10, max_tool_calls: 1000 },
      approval_points: [],
    });
    vague.steps = vague.steps.map((s) => ({ ...s, verification: [], expected_outputs: [], affected_files: [], human_checkpoint: false }));
    const t = scorePlan(vague);
    expect(t.confidence).toBe("LOW");
    expect(t.overall).toBeLessThan(65);
  });
});
