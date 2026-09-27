/**
 * Tool contract (master prompt "Tool contract", TRD §10.2).
 * Tools are declared data, not code-bound conventions; scope enforcement
 * happens in the tool gateway, never in prompts.
 */
import { z } from "zod";
import { RiskLevel } from "./common.js";

export const ToolSideEffect = z.enum([
  "none",
  "read_repo",
  "read_workspace",
  "write_workspace",
  "external_submit",
  "write_memory",
  "browser_launch",
]);
export type ToolSideEffect = z.infer<typeof ToolSideEffect>;

export const ToolContract = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, "snake_case tool name"),
  description: z.string().min(10).max(500),
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()),
  side_effects: z.array(ToolSideEffect).min(1),
  risk_level: RiskLevel,
  required_scopes: z.array(z.string()).min(1),
  undo_strategy: z.string().min(3).max(300),
  timeout_ms: z.number().int().positive().max(300_000),
  /**
   * workspace_pure: pure function of (workspace, input) → structural idempotency.
   * not_idempotent: has external or first-time effects (memory insert, browser launch);
   * callers pass explicit idempotency keys where it matters.
   */
  idempotency: z.enum(["workspace_pure", "not_idempotent"]),
});
export type ToolContract = z.infer<typeof ToolContract>;

/** Result envelope every tool returns to the harness. */
export const ToolResult = z.object({
  ok: z.boolean(),
  summary: z.string().max(2000),
  /** handle to full output stored outside the prompt (artifact id) when large */
  output_ref: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
});
export type ToolResult = z.infer<typeof ToolResult>;
