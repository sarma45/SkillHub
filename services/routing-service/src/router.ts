/**
 * Router: turns deterministic catalog decisions into real adapters and
 * durable decision receipts (master prompt §2.7: every routing decision is
 * logged with question, answer, confidence, policy version, action).
 */
import type { Database as DB } from "better-sqlite3";
import type { ModelGatewayPort, ToolUsePort } from "@cockpit/model-gateway";
import { createModelAdapterByKey, createToolUseAdapterByKey } from "@cockpit/model-gateway";
import { insertDecision } from "@cockpit/db";
import { routeProvider, type Purpose, type RouteDecision } from "./catalog.js";

export function routeAndRecord(
  db: DB,
  opts: { projectId: string; runId?: string | null; purpose: Purpose }
): { decision: RouteDecision; model: ModelGatewayPort | null; tools: ToolUsePort | null } {
  const decision = routeProvider(opts.purpose);
  const model = createModelAdapterByKey(decision.adapter);
  const tools = decision.tools_adapter ? createToolUseAdapterByKey(decision.tools_adapter) : null;

  insertDecision(db, {
    project_id: opts.projectId,
    run_id: opts.runId ?? null,
    decision_kind: "route",
    state_hash: null,
    provider: "routing-policy",
    question_json: JSON.stringify({ purpose: opts.purpose }),
    answer_json: JSON.stringify({ provider_id: decision.provider_id, adapter: decision.adapter }),
    confidence: 1, // deterministic policy, not a model guess
    policy_version: decision.policy_version,
    action: "route",
    human_override: null,
  });

  return { decision, model, tools };
}

export { routeProvider, listProviders } from "./catalog.js";
export type { RouteDecision, Purpose, ProviderEntry } from "./catalog.js";
