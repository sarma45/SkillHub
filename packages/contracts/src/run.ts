/**
 * Run + evidence contracts. Runs are the only unit that executes tools;
 * every tool call becomes a durable run_event receipt.
 */
import { z } from "zod";
import { RiskLevel, Severity, EvidenceLabel, SHA256, IsoDateTime } from "./common.js";

export const RunState = z.enum([
  "queued",
  "running",
  "paused",
  "verifying",
  "needs_repair",
  "ready_for_review",
  "awaiting_integration_approval",
  "integrated",
  "cancelled",
  "failed",
]);
export type RunState = z.infer<typeof RunState>;

export const RunControlAction = z.enum(["pause", "resume", "cancel"]);
export type RunControlAction = z.infer<typeof RunControlAction>;

export const CreateRunRequest = z.object({
  plan_hash: SHA256,
  workspace: z.literal("isolated").default("isolated"),
  max_duration_ms: z.number().int().positive().max(3_600_000).default(900_000),
  max_retries: z.number().int().min(0).max(10).default(2),
  /** "autonomous" activates the model-driven tool-use loop (capability-gated). */
  mode: z.enum(["normal", "autonomous"]).default("normal"),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const ActorType = z.enum(["user", "agent", "system", "evaluator", "security"]);
export type ActorType = z.infer<typeof ActorType>;

export const RunEventType = z.enum([
  "run_created",
  "run_started",
  "phase_changed",
  "step_started",
  "step_completed",
  "step_failed",
  "tool_requested",
  "tool_result",
  "tool_denied",
  "model_call",
  "decision_recorded",
  "checkpoint_saved",
  "budget_exceeded",
  "verification_started",
  "verification_result",
  "human_checkpoint",
  "run_paused",
  "run_resumed",
  "run_cancelled",
  "run_completed",
  "run_failed",
  "secret_redacted",
  "security_finding",
]);
export type RunEventType = z.infer<typeof RunEventType>;

export const RunEvent = z.object({
  id: z.string(),
  run_id: z.string(),
  sequence: z.number().int().positive(),
  event_type: RunEventType,
  actor_type: ActorType,
  payload: z.record(z.unknown()).default({}),
  redacted: z.boolean().default(false),
  created_at: IsoDateTime,
});
export type RunEvent = z.infer<typeof RunEvent>;

export const EvidenceStatus = z.enum(["passed", "failed", "warning", "skipped", "pending"]);

export const EvidenceDto = z.object({
  id: z.string(),
  run_id: z.string(),
  check_type: z.string(),
  status: EvidenceStatus,
  severity: Severity,
  label: EvidenceLabel,
  command_or_method: z.string(),
  artifact_id: z.string().nullable(),
  result: z.record(z.unknown()).default({}),
  human_required: z.boolean(),
  created_at: IsoDateTime,
});
export type EvidenceDto = z.infer<typeof EvidenceDto>;

export const ArtifactDto = z.object({
  id: z.string(),
  project_id: z.string(),
  run_id: z.string().nullable(),
  kind: z.string(),
  uri: z.string(),
  sha256: SHA256,
  size_bytes: z.number().int().nonnegative(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
  metadata: z.record(z.unknown()).default({}),
  created_at: IsoDateTime,
});
export type ArtifactDto = z.infer<typeof ArtifactDto>;

export const RunDto = z.object({
  id: z.string(),
  task_id: z.string(),
  plan_id: z.string(),
  plan_hash: SHA256,
  workspace_id: z.string(),
  state: RunState,
  attempt: z.number().int().nonnegative(),
  model_route: z.string(),
  budget: z.record(z.unknown()),
  budget_used: z.record(z.unknown()).default({}),
  started_at: IsoDateTime.nullable(),
  ended_at: IsoDateTime.nullable(),
  failure_code: z.string().nullable(),
});
export type RunDto = z.infer<typeof RunDto>;

/** PR draft payload the user must approve verbatim (nothing auto-submits). */
export const PullRequestDraftRequest = z.object({
  branch: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._/-]{2,80}$/i, "branch name"),
  title: z.string().min(4).max(120),
  body: z.string().min(10).max(20000),
  acknowledged_risks: z.boolean(),
});
export type PullRequestDraftRequest = z.infer<typeof PullRequestDraftRequest>;

export const PullRequestDraftDto = z.object({
  draft_id: z.string(),
  run_id: z.string(),
  status: z.enum(["draft_pending_approval", "approved_not_submitted", "submitted"]),
  payload: PullRequestDraftRequest,
  evidence_ids: z.array(z.string()),
  created_at: IsoDateTime,
});
export type PullRequestDraftDto = z.infer<typeof PullRequestDraftDto>;
