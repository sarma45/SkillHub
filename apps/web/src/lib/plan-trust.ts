/**
 * Plan trust scoring (objective #6: score reliability at the moment of approval).
 *
 * Deterministic heuristics over the real PlanDocument — no model in the loop,
 * so the same plan always scores identically (plans are hash-compared, so a
 * model here would break reproducibility). Every sub-score ships with the
 * rule that produced it; the UI renders those rules, not just numbers.
 *
 * Scoring axes (each 0–100, overall = weighted mean):
 *   verification — share of steps declaring at least one verification method
 *   specificity  — steps with concrete outputs and/or affected files
 *   budget       — headroom against structural caps (tool calls, duration, retries)
 *   assumption   — mean confidence of stated assumptions (neutral when none)
 *   human        — human checkpoints present (brief has human review; never
 *                  rewards autonomy over oversight)
 */
import type { PlanDocument } from "@cockpit/contracts";

export interface ScoreComponent {
  key: string;
  label: string;
  score: number; // 0-100
  weight: number;
  rule: string;
}

export interface PlanTrustScore {
  overall: number; // 0-100, one decimal
  confidence: "LOW" | "MEDIUM" | "HIGH";
  components: ScoreComponent[];
}

const BUDGET_CAPS = { toolCalls: 1000, durationMs: 3_600_000, retries: 10 } as const;

function pct(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 100);
}

export function scorePlan(plan: PlanDocument): PlanTrustScore {
  const steps = plan.steps;
  const n = steps.length;

  const verifiedSteps = steps.filter((s) => s.verification.length > 0).length;
  const verification = pct(verifiedSteps, n);

  const specificSteps = steps.filter(
    (s) => s.expected_outputs.length > 0 || s.affected_files.length > 0
  ).length;
  const specificity = pct(specificSteps, n);

  // Headroom: a budget pinned at the structural cap signals an unplanned
  // blanket allowance; generous-but-bounded headroom scores high.
  const headroom = (used: number, cap: number) => 1 - Math.min(used / cap, 1);
  const budgetRaw =
    (0.4 * headroom(plan.budget.max_tool_calls, BUDGET_CAPS.toolCalls) +
      0.4 * headroom(plan.budget.max_duration_ms, BUDGET_CAPS.durationMs) +
      0.2 * headroom(plan.budget.max_retries, BUDGET_CAPS.retries)) *
    100;
  const budget = Math.round(budgetRaw);

  const assumption =
    plan.assumptions.length === 0
      ? 100
      : Math.round(
          (plan.assumptions.reduce((sum, a) => sum + a.confidence, 0) / plan.assumptions.length) * 100
        );

  // Human oversight: approval points + checkpoint steps (capped credit at 2+).
  const humanPoints = plan.approval_points.length + steps.filter((s) => s.human_checkpoint).length;
  const human = Math.min(humanPoints, 2) * 50;

  const components: ScoreComponent[] = [
    {
      key: "verification",
      label: "Verification coverage",
      score: verification,
      weight: 0.3,
      rule: `${verifiedSteps}/${n} steps declare a verification method (tests, checks)`,
    },
    {
      key: "specificity",
      label: "Step specificity",
      score: specificity,
      weight: 0.25,
      rule: `${specificSteps}/${n} steps name expected outputs or affected files`,
    },
    {
      key: "budget",
      label: "Budget headroom",
      score: budget,
      weight: 0.2,
      rule: `tool calls ${plan.budget.max_tool_calls}/1000 · duration ${Math.round(plan.budget.max_duration_ms / 1000)}s/3600s · retries ${plan.budget.max_retries}/10 (weighted headroom against structural caps)`,
    },
    {
      key: "assumption",
      label: "Assumption confidence",
      score: assumption,
      weight: 0.15,
      rule:
        plan.assumptions.length === 0
          ? "no assumptions stated — neutral full score"
          : `mean stated confidence across ${plan.assumptions.length} assumption(s)`,
    },
    {
      key: "human",
      label: "Human oversight",
      score: human,
      weight: 0.1,
      rule: `${humanPoints} approval point(s)/checkpoint step(s) (credit capped at 2)`,
    },
  ];

  const overall = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0) * 10) / 10;
  const confidence: PlanTrustScore["confidence"] = overall >= 85 ? "HIGH" : overall >= 65 ? "MEDIUM" : "LOW";
  return { overall, confidence, components };
}
