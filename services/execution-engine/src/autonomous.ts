/**
 * Autonomous mode (Phase 3+): a REAL model-driven tool-use loop.
 *
 * The model (Anthropic native tool-use, or the scripted adapter in offline
 * runs) proposes the next tool call each turn; deterministic policy gates
 * every call (scopes, budgets, cancellation, deadlines) before it executes.
 * The model never bypasses policy: a denied tool returns an error message
 * back to the model, not a silent failure.
 *
 * Stop conditions: final text, budget exhaustion, deadline, cancellation,
 * or max turns. Everything is receipted as run events.
 */
import type { PlanDocument, ToolResult } from "@cockpit/contracts";
import type { Scope } from "@cockpit/policy";
import type { ToolUsePort, ToolUseMessage } from "@cockpit/model-gateway";
import { Workspace } from "./workspace.js";
import { TOOLS, type ToolContext, ToolScopeDenied } from "./tools.js";
import { makeRememberTool, makeBrowserVerifyTool, type AgentToolDeps } from "./agent-tools.js";

export interface AutonomousOptions extends Omit<AutonomousOptionsBase, "io"> {
  io: AutonomousOptionsBase["io"];
}

export interface AutonomousOptionsBase {
  workspaceBaseDir: string;
  workspaceId: string;
  sourceRoot: string;
  plan: PlanDocument;
  planHash: string;
  grantedScopes: readonly Scope[];
  modelRoute: string;
  loop: ToolUsePort;
  maxTurns: number;
  deadline: number;
  agentDeps: AgentToolDeps;
  taskRequest: string;
  contextSummary: string;
  io: {
    emit(event: {
      event_type: string;
      actor_type: "user" | "agent" | "system" | "evaluator" | "security";
      payload: Record<string, unknown>;
    }): void;
    isCancelRequested(): boolean;
  };
}

export interface AutonomousOutcome {
  status: "ready_for_review" | "failed" | "cancelled" | "needs_repair";
  failure_code: string | null;
  changedFiles: string[];
  diff: Awaited<ReturnType<Workspace["diff"]>>;
  workspaceHash: string;
  toolCallsUsed: number;
  turnsUsed: number;
  finalText: string | null;
}

/** Full tool set available to the autonomous agent: core + agent-only tools. */
export function buildAutonomousTools(agentDeps: AgentToolDeps): Record<string, (typeof TOOLS)[string]> {
  return {
    ...TOOLS,
    remember: makeRememberTool(agentDeps),
    browser_verify: makeBrowserVerifyTool(agentDeps),
  };
}

function toolSchemasFor(tools: Record<string, { contract: { name: string; description: string; input_schema: Record<string, unknown> } }>) {
  return Object.values(tools).map((t) => ({
    name: t.contract.name,
    description: t.contract.description,
    input_schema: t.contract.input_schema,
  }));
}

const SYSTEM_TEMPLATE = `You are the autonomous engineering agent of a human-supervised AI engineering cockpit.
You are executing an APPROVED plan inside an isolated disposable workspace. A human reviews every diff afterwards.

Goal: {{REQUEST}}

Approved plan summary:
{{PLAN}}

Project context (verified/inferred labels included):
{{CONTEXT}}

Rules:
1. Work only toward the goal. Do not invent extra features.
2. Use the provided tools step by step. Prefer reading before editing.
3. Every file edit must land in the workspace via edit_file; run the test tool after edits.
4. If a tool call is denied, do NOT retry it unchanged; adapt or finish.
5. You may call remember to save durable lessons (they require human approval) and
   browser_verify to visually verify loopback URLs.
6. When the goal is met and tests pass, STOP and reply with a short summary of what changed and why.
7. Never claim a check passed unless the tool result shows it.`;

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

export async function runAutonomous(opts: AutonomousOptions): Promise<AutonomousOutcome> {
  const { io } = opts;
  const started = Date.now();
  const budget = opts.plan.budget;
  let toolCalls = 0;
  let turns = 0;

  io.emit({
    event_type: "run_started",
    actor_type: "system",
    payload: { plan_hash: opts.planHash, model_route: opts.loop.route, mode: "autonomous" },
  });

  const ws = await Workspace.create(opts.workspaceBaseDir, opts.workspaceId, opts.sourceRoot);
  const tools = buildAutonomousTools(opts.agentDeps);
  const schemas = toolSchemasFor(tools);

  const system = fillTemplate(SYSTEM_TEMPLATE, {
    REQUEST: opts.taskRequest.slice(0, 2000),
    PLAN: opts.plan.steps.map((s) => `- ${s.title}: ${s.tools.join(", ")}`).join("\n").slice(0, 2000),
    CONTEXT: opts.contextSummary.slice(0, 6000),
  });

  const messages: ToolUseMessage[] = [
    { role: "user", content: `Execute the approved plan for: ${opts.taskRequest}\nBegin. Use tools.` },
  ];

  const throwIfCancelled = () => {
    if (opts.io.isCancelRequested()) throw new CancelledError();
  };

  const ctxFor = (toolName: string): ToolContext => {
    const impl = tools[toolName];
    return {
      workspaceRoot: ws.root,
      grantedScopes: opts.grantedScopes,
      receipt: (payload) => {
        io.emit({ event_type: "tool_result", actor_type: "agent", payload: { tool: toolName, ...payload } });
      },
      throwIfCancelled,
      timeoutMs: impl?.contract.timeout_ms ?? 30_000,
    };
  };

  try {
    io.emit({ event_type: "phase_changed", actor_type: "system", payload: { phase: "autonomous_execute" } });

    while (turns < opts.maxTurns) {
      throwIfCancelled();
      if (Date.now() > opts.deadline) {
        io.emit({ event_type: "budget_exceeded", actor_type: "system", payload: { budget: "duration" } });
        return finish("failed", "BUDGET_EXCEEDED");
      }
      if (toolCalls >= budget.max_tool_calls) {
        io.emit({ event_type: "budget_exceeded", actor_type: "system", payload: { budget: "tool_calls" } });
        return finish("failed", "BUDGET_EXCEEDED");
      }

      turns++;
      const turn = await opts.loop.nextTurn({
        system,
        messages,
        tools: schemas,
        max_tokens: 2048,
      });

      if (turn.kind === "text") {
        io.emit({ event_type: "agent_final_text", actor_type: "agent", payload: { text: turn.text.slice(0, 2000) } });
        break;
      }

      const toolName = turn.tool_name;
      const impl = tools[toolName];
      messages.push({
        role: "assistant_text",
        content: `[tool request] ${toolName} ${JSON.stringify(turn.input).slice(0, 500)}`,
      });

      if (!impl) {
        io.emit({ event_type: "tool_denied", actor_type: "system", payload: { tool: toolName, reason: "unknown-tool" } });
        messages.push({
          role: "tool_result",
          tool_use_id: turn.tool_use_id,
          tool_name: toolName,
          content: `ERROR: unknown tool ${toolName}. Available: ${Object.keys(tools).join(", ")}`,
          is_error: true,
        });
        continue;
      }

      if (toolCalls >= budget.max_tool_calls) {
        messages.push({
          role: "tool_result",
          tool_use_id: turn.tool_use_id,
          tool_name: toolName,
          content: "ERROR: tool-call budget exhausted; finish now with a summary.",
          is_error: true,
        });
        continue;
      }

      io.emit({ event_type: "tool_requested", actor_type: "agent", payload: { tool: toolName, input_preview: JSON.stringify(turn.input).slice(0, 200) } });
      toolCalls++;

      let res: ToolResult;
      try {
        // scope enforcement happens INSIDE each tool implementation (deny-by-default)
        const ctx = ctxFor(toolName);
        res = await impl.run(ctx, turn.input);
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        if (err instanceof ToolScopeDenied) {
          io.emit({ event_type: "tool_denied", actor_type: "system", payload: { tool: toolName, reason: "scope-denied", scopes: err.required } });
          messages.push({
            role: "tool_result",
            tool_use_id: turn.tool_use_id,
            tool_name: toolName,
            content: `ERROR: scope denied for ${toolName} (requires ${err.required.join(", ")}). Do not retry unchanged.`,
            is_error: true,
          });
          continue;
        }
        messages.push({
          role: "tool_result",
          tool_use_id: turn.tool_use_id,
          tool_name: toolName,
          content: `ERROR: ${err instanceof Error ? err.message : "unknown"}`,
          is_error: true,
        });
        continue;
      }

      io.emit({
        event_type: "step_completed",
        actor_type: "agent",
        payload: { tool: toolName, ok: res.ok, summary: res.summary.slice(0, 300) },
      });
      messages.push({
        role: "tool_result",
        tool_use_id: turn.tool_use_id,
        tool_name: toolName,
        content: `${res.ok ? "OK" : "FAILED"}: ${res.summary}`,
        is_error: !res.ok,
      });
    }

    if (turns >= opts.maxTurns) {
      io.emit({ event_type: "budget_exceeded", actor_type: "system", payload: { budget: "turns" } });
      return finish("failed", "MAX_TURNS_EXCEEDED");
    }

    // verify: run tests once at the end regardless of model behavior
    io.emit({ event_type: "phase_changed", actor_type: "system", payload: { phase: "verify" } });
    const testImpl = tools["run_tests"];
    if (testImpl && toolCalls < budget.max_tool_calls) {
      toolCalls++;
      const res = await testImpl.run(ctxFor("run_tests"), { command: "npm test" });
      io.emit({ event_type: "verification_result", actor_type: "evaluator", payload: { check: "tests", status: res.ok ? "passed" : "failed" } });
      if (!res.ok) {
        return finish("needs_repair", "TESTS_FAILED");
      }
    }

    return finish("ready_for_review", null);
  } catch (err) {
    if (err instanceof CancelledError) {
      io.emit({ event_type: "run_cancelled", actor_type: "user", payload: {} });
      return finish("cancelled", null);
    }
    if (err instanceof ToolScopeDenied) {
      io.emit({ event_type: "run_failed", actor_type: "system", payload: { reason: `scope denied: ${err.required.join(",")}` } });
      return finish("failed", "TOOL_SCOPE_DENIED");
    }
    io.emit({ event_type: "run_failed", actor_type: "system", payload: { reason: err instanceof Error ? err.message : "unknown" } });
    return finish("failed", "INTERNAL_ERROR");
  }

  async function finish(status: AutonomousOutcome["status"], failureCode: string | null): Promise<AutonomousOutcome> {
    const diff = await ws.diff();
    const changed = await ws.changedFiles();
    const hash = await ws.hashAll();
    io.emit({
      event_type: status === "ready_for_review" ? "run_completed" : "run_failed",
      actor_type: "system",
      payload: { status, changed_files: changed.length, failure_code: failureCode, turns, tool_calls: toolCalls, mode: "autonomous" },
    });
    return {
      status,
      failure_code: failureCode,
      changedFiles: changed,
      diff,
      workspaceHash: hash,
      toolCallsUsed: toolCalls,
      turnsUsed: turns,
      finalText: null,
    };
  }
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}
