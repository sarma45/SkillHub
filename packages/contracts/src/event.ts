/**
 * Durable event (outbox) + worker job contracts (TRD §7, §8.4).
 * State change + outbox event commit atomically; workers claim jobs with leases.
 */
import { z } from "zod";
import { IsoDateTime } from "./common.js";

export const OutboxEvent = z.object({
  id: z.string(),
  aggregate_type: z.enum(["project", "task", "plan", "run", "skill", "finding"]),
  aggregate_id: z.string(),
  event_type: z.string().max(80),
  schema_version: z.string(),
  payload: z.record(z.unknown()).default({}),
  sequence: z.number().int().positive(),
  published: z.boolean().default(false),
  created_at: IsoDateTime,
});
export type OutboxEvent = z.infer<typeof OutboxEvent>;

export const JobStatus = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "dead_letter",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobContract = z.object({
  job_id: z.string(),
  job_type: z.enum([
    "index_repository",
    "generate_plan",
    "execute_run",
    "evaluate_run",
    "security_scan",
  ]),
  aggregate_id: z.string(),
  attempt: z.number().int().nonnegative(),
  lease_owner: z.string().nullable(),
  fencing_token: z.number().int().nonnegative(),
  lease_expires_at: IsoDateTime.nullable(),
  heartbeat_at: IsoDateTime.nullable(),
  cancel_requested: z.boolean().default(false),
  input_artifact_refs: z.array(z.string()).default([]),
  output_artifact_refs: z.array(z.string()).default([]),
  status: JobStatus,
  failure_code: z.string().nullable(),
  retry_class: z
    .enum(["none", "same_attempt", "new_attempt", "provider_switch", "human_action", "replan"])
    .default("none"),
  max_attempts: z.number().int().positive().default(3),
});
export type JobContract = z.infer<typeof JobContract>;
