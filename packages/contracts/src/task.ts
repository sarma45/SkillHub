/**
 * Task brief + lifecycle states. State names follow the master prompt's
 * canonical machine; a subset is active in MVP (see contracts/state-transitions.yaml).
 */
import { z } from "zod";
import { RiskLevel, IsoDateTime } from "./common.js";

/** Full set from master prompt §5; MVP activates a subset (see policy). */
export const TaskState = z.enum([
  "DRAFT",
  "FRAMED",
  "AWAITING_CLARIFICATION",
  "PLANNED",
  "AWAITING_PLAN_APPROVAL",
  "EXECUTING",
  "PAUSED_FOR_HUMAN",
  "VERIFYING",
  "NEEDS_REPAIR",
  "REPLAN_REQUIRED",
  "READY_FOR_REVIEW",
  "AWAITING_INTEGRATION_APPROVAL",
  "INTEGRATED",
  "LEARNED",
  "CANCELLED",
  "FAILED",
  "BLOCKED",
  "EXPIRED",
  "REJECTED",
  "ROLLED_BACK",
  "INTEGRATION_FAILED",
  "SECURITY_BLOCKED",
]);
export type TaskState = z.infer<typeof TaskState>;

export const TaskStatusSchema = z.object({
  state: TaskState,
  version: z.number().int().nonnegative(),
});

export const TaskBriefSchema = z.object({
  request: z.string().min(8).max(4000),
  success_criteria: z.array(z.string().min(3).max(400)).min(1).max(10),
  non_goals: z.array(z.string().min(3).max(400)).max(10).default([]),
  risk: RiskLevel,
  assumptions: z
    .array(
      z.object({
        text: z.string().min(3).max(500),
        confidence: z.number().min(0).max(1),
        source: z.string().max(120),
      })
    )
    .max(10)
    .default([]),
  open_questions: z.array(z.string().min(3).max(400)).max(10).default([]),
});
export type TaskBrief = z.infer<typeof TaskBriefSchema>;

export const CreateTaskRequest = z.object({
  request: TaskBriefSchema.shape.request,
  success_criteria: TaskBriefSchema.shape.success_criteria,
  non_goals: TaskBriefSchema.shape.non_goals,
  risk: RiskLevel,
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

/** Serialized task as returned by GET /tasks/{id}. */
export const TaskDto = z.object({
  id: z.string(),
  project_id: z.string(),
  brief: TaskBriefSchema,
  state: TaskState,
  version: z.number().int().nonnegative(),
  created_by: z.string(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type TaskDto = z.infer<typeof TaskDto>;
