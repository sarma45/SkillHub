/**
 * Ports (TRD §4.2): provider-specific logic stays behind these interfaces.
 * The MVP ships a deterministic mock adapter; an Anthropic adapter activates
 * only when ANTHROPIC_API_KEY is set (provider decisions are recorded).
 */
import type { PlanDocument } from "@cockpit/contracts";

export interface ModelCallReceipt {
  provider: string;
  model: string;
  latency_ms: number;
  input_chars: number;
  output_chars: number;
  ok: boolean;
  error_code: string | null;
}

export interface ModelGatewayPort {
  readonly route: string;
  complete(prompt: ModelRequest): Promise<{ text: string; receipt: ModelCallReceipt }>;
}

/**
 * Tool-use loop port (real autonomous mode). The model receives a system
 * prompt + conversation and either returns text (final answer) or a tool call
 * (name + JSON input). Deterministic policy gates every tool before it runs.
 */
export interface ToolUsePort {
  readonly route: string;
  /** One model turn. Returns exactly one of: final text or a tool request. */
  nextTurn(turn: ToolUseTurnRequest): Promise<ToolUseTurnResult>;
}

export interface ToolUseTurnRequest {
  system: string;
  /** Alternating conversation; tool results appear as tool role entries. */
  messages: ToolUseMessage[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  max_tokens: number;
}

export type ToolUseMessage =
  | { role: "user"; content: string }
  | { role: "assistant_text"; content: string }
  | { role: "tool_result"; tool_use_id: string; tool_name: string; content: string; is_error: boolean };

export type ToolUseTurnResult =
  | { kind: "text"; text: string; receipt: ModelCallReceipt }
  | { kind: "tool_call"; tool_use_id: string; tool_name: string; input: Record<string, unknown>; receipt: ModelCallReceipt };


export interface ModelRequest {
  purpose: "planning" | "editing" | "verification_analysis";
  system: string;
  user: string;
  max_tokens: number;
}

export interface PlannerPort {
  generatePlan(input: {
    brief: { request: string; success_criteria: string[]; non_goals: string[]; risk: string };
    repoMapSummary: string;
  }): Promise<{ plan: PlanDocument; receipt: ModelCallReceipt; provider: "deterministic" | "anthropic" }>;
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: string, cause?: unknown) {
    super(`Provider ${provider} unavailable`);
    this.name = "ProviderUnavailableError";
    this.cause = cause;
  }
}

/** Deterministic decision receipt (Jev dormant; recorded for auditability). */
export interface DecisionReceipt {
  decision_id: string;
  kind: "choice" | "score" | "noul";
  question: string;
  answer: string;
  confidence: number;
  provider: "deterministic";
  policy_version: string;
  action: "continue" | "ask_human" | "route" | "block" | "escalate";
  fallback: string;
}
