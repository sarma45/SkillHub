import { describe, it, expect } from "vitest";
import { generatePlan, generatePlanDeterministic } from "../src/index.js";
import { planHash } from "@cockpit/policy";
import type { RepositoryMap } from "@cockpit/contracts";
import { readFileSync } from "node:fs";
import path from "node:path";

const map: RepositoryMap = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../fixtures/sample-repo-map.json"), "utf-8")
);

const brief = {
  request: "Add a bounded login feature",
  success_criteria: ["login form renders", "tests pass"],
  non_goals: ["OAuth", "password reset"],
  risk: "low" as const,
};

describe("deterministic planner", () => {
  it("produces identical plans for identical input (comparable across runs)", () => {
    const a = generatePlanDeterministic({ brief, repoMap: map });
    const b = generatePlanDeterministic({ brief, repoMap: map });
    expect(planHash(a)).toBe(planHash(b));
  });

  it("includes at least one verification step per plan (80% gate)", () => {
    const plan = generatePlanDeterministic({ brief, repoMap: map });
    const withVerification = plan.steps.filter((s) => s.verification.length > 0);
    expect(withVerification.length / plan.steps.length).toBeGreaterThanOrEqual(0.8);
  });

  it("routes UI requests to app surface, auth to src/auth", () => {
    const auth = generatePlanDeterministic({ brief, repoMap: map });
    expect(auth.steps.some((s) => s.title.includes("src/auth"))).toBe(true);

    const ui = generatePlanDeterministic({
      brief: { ...brief, request: "Add a settings page with a theme toggle" },
      repoMap: map,
    });
    expect(ui.steps.some((s) => s.title.includes("app") || s.title.includes("src/components"))).toBe(true);
  });

  it("binds plan hash to content; hash changes when steps change", async () => {
    const { plan, plan_hash } = await generatePlan({ brief, repoMap: map });
    expect(plan_hash).toBe(planHash(plan));
    const mutated = { ...plan, steps: plan.steps.slice(0, 2) };
    expect(planHash(mutated)).not.toBe(plan_hash);
  });

  it("carries a budget with bounded retries", () => {
    const plan = generatePlanDeterministic({ brief, repoMap: map });
    expect(plan.budget.max_retries).toBeLessThanOrEqual(2);
    expect(plan.budget.max_tool_calls).toBeGreaterThan(0);
  });
});
