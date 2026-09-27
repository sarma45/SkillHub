/**
 * Versioned plan contract (master prompt "Plan schema", TRD §5.1 Plan aggregate).
 * Approval is bound to plan_hash + version; a stale hash is a 409.
 */
import { z } from "zod";
import { RiskLevel, SHA256, IsoDateTime } from "./common.js";

export const PlanStep = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(3).max(300),
  depends_on: z.array(z.string()).max(20).default([]),
  tools: z.array(z.string()).max(20).default([]),
  expected_outputs: z.array(z.string().max(300)).max(20).default([]),
  verification: z.array(z.string().max(300)).max(10).default([]),
  /** files this step intends to touch (advisory; enforced per-tool at execution) */
  affected_files: z.array(z.string().max(300)).max(50).default([]),
  human_checkpoint: z.boolean().default(false),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanBudget = z.object({
  max_cost_usd: z.number().nonnegative().max(1000),
  max_duration_ms: z.number().int().positive().max(3_600_000),
  max_retries: z.number().int().min(0).max(10),
  max_tool_calls: z.number().int().positive().max(1000),
});
export type PlanBudget = z.infer<typeof PlanBudget>;

export const PlanDocument = z.object({
  goal: z.string().min(8).max(1000),
  success_criteria: z.array(z.string().min(3).max(400)).min(1).max(10),
  non_goals: z.array(z.string().min(3).max(400)).max(10),
  assumptions: z.array(
    z.object({
      text: z.string().min(3).max(500),
      confidence: z.number().min(0).max(1),
      source: z.string().max(120),
    })
  ),
  steps: z.array(PlanStep).min(1).max(30),
  risk: RiskLevel,
  approval_points: z.array(z.string().max(200)).max(10),
  budget: PlanBudget,
});
export type PlanDocument = z.infer<typeof PlanDocument>;

export const PlanDto = z.object({
  id: z.string(),
  task_id: z.string(),
  version: z.number().int().positive(),
  plan_hash: SHA256,
  plan: PlanDocument,
  status: z.enum(["proposed", "approved", "rejected", "superseded", "stale"]),
  approved_by: z.string().nullable(),
  approved_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});
export type PlanDto = z.infer<typeof PlanDto>;

export const ApprovePlanRequest = z.object({
  plan_hash: SHA256,
  approved_by: z.string().min(1).max(120),
  comment: z.string().max(500).default(""),
});
export type ApprovePlanRequest = z.infer<typeof ApprovePlanRequest>;
