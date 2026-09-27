/**
 * Execution engine (Phase 3 "Execute" + Phase 6 "Verify"): executes an
 * approved plan step-by-step inside an isolated workspace.
 *
 * Guarantees (TRD §7):
 *  - cancellation checked before every tool call and workspace write
 *  - budgets: duration, tool calls, retries — exhaustion is terminal
 *  - every tool call produces a durable, redacted receipt event
 *  - failed verification enters a bounded repair loop (max plan.budget.max_retries)
 *  - repository content is data, never instructions (injection fixture safe)
 */
import type {
  PlanDocument,
  RunEvent,
  ToolResult,
} from "@cockpit/contracts";
import type { Scope } from "@cockpit/policy";
import { redactSecrets } from "@cockpit/policy";
import { Workspace } from "./workspace.js";
import { TOOLS, type ToolContext, ToolScopeDenied } from "./tools.js";

export interface EngineIo {
  emit(event: {
    event_type: string;
    actor_type: "user" | "agent" | "system" | "evaluator" | "security";
    payload: Record<string, unknown>;
  }): void;
  isCancelRequested(): boolean;
}

export interface ExecuteOptions {
  workspaceBaseDir: string;
  workspaceId: string;
  sourceRoot: string;
  plan: PlanDocument;
  planHash: string;
  grantedScopes: readonly Scope[];
  modelRoute: string;
  /** deterministic per-run behavior for the MVP executor */
  mode?: "normal" | "failing_tests" | "provider_timeout";
  io: EngineIo;
  deadline: number;
}

export interface ExecuteOutcome {
  status: "ready_for_review" | "failed" | "cancelled" | "needs_repair";
  failure_code: string | null;
  changedFiles: string[];
  diff: Awaited<ReturnType<Workspace["diff"]>>;
  workspaceHash: string;
  toolCallsUsed: number;
}

const STEP_GRANTS: Record<string, readonly Scope[]> = {
  read_file: ["workspace:read"],
  search: ["workspace:read"],
  list_tree: ["workspace:read"],
  edit_file: ["workspace:write"],
  run_tests: ["workspace:read"],
  compute_diff: ["workspace:read"],
};

export async function executePlan(opts: ExecuteOptions): Promise<ExecuteOutcome> {
  const { io } = opts;
  const started = Date.now();
  const budget = opts.plan.budget;
  let toolCalls = 0;
  let repairRounds = 0;

  io.emit({ event_type: "run_started", actor_type: "system", payload: { plan_hash: opts.planHash, model_route: opts.modelRoute } });

  const ws = await Workspace.create(opts.workspaceBaseDir, opts.workspaceId, opts.sourceRoot);
  let testStatus: "not_run" | "passed" | "failed" = "not_run";

  const throwIfCancelled = () => {
    if (opts.io.isCancelRequested()) throw new CancelledError();
  };

  const ctxFor = (toolName: string): ToolContext => ({
    workspaceRoot: ws.root,
    grantedScopes: opts.grantedScopes.filter((s) => STEP_GRANTS[toolName]?.includes(s)),
    receipt: (payload) => {
      const r = redactSecrets(JSON.stringify(payload));
      io.emit({
        event_type: "tool_result",
        actor_type: "agent",
        payload: { tool: (JSON.parse(r.redacted) as Record<string, unknown>).tool ?? "unknown", ...safeParse(r.redacted) },
      });
    },
    throwIfCancelled,
    timeoutMs: 30_000,
  });

  try {
    io.emit({ event_type: "phase_changed", actor_type: "system", payload: { phase: "execute" } });

    for (const step of opts.plan.steps) {
      throwIfCancelled();
      io.emit({ event_type: "step_started", actor_type: "agent", payload: { step_id: step.id, title: step.title } });

      if (Date.now() > opts.deadline) {
        io.emit({ event_type: "budget_exceeded", actor_type: "system", payload: { budget: "duration" } });
        return finish("failed", "BUDGET_EXCEEDED");
      }

      for (const toolName of step.tools) {
        throwIfCancelled();
        if (toolCalls >= budget.max_tool_calls) {
          io.emit({ event_type: "budget_exceeded", actor_type: "system", payload: { budget: "tool_calls" } });
          return finish("failed", "BUDGET_EXCEEDED");
        }
        const impl = TOOLS[toolName];
        if (!impl) {
          io.emit({ event_type: "tool_denied", actor_type: "system", payload: { tool: toolName, reason: "unknown-tool" } });
          return finish("failed", "UNKNOWN_TOOL");
        }

        io.emit({ event_type: "tool_requested", actor_type: "agent", payload: { tool: toolName, step_id: step.id } });
        toolCalls++;

        let res: ToolResult;
        try {
          const input = toolInputFor(toolName, step.id, opts, testStatus);
          res = await impl.run(ctxFor(toolName), input);
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          if (err instanceof ToolScopeDenied) {
            io.emit({ event_type: "tool_denied", actor_type: "system", payload: { tool: toolName, reason: "scope-denied", scopes: err.required } });
            return finish("failed", "TOOL_SCOPE_DENIED");
          }
          io.emit({ event_type: "step_failed", actor_type: "agent", payload: { step_id: step.id, error: msg(err) } });
          return finish("failed", "TOOL_ERROR");
        }

        if (!res.ok && toolName === "edit_file") {
          io.emit({ event_type: "step_failed", actor_type: "agent", payload: { step_id: step.id, tool: toolName, summary: res.summary } });
          return finish("failed", "EDIT_FAILED");
        }
        if (toolName === "run_tests") {
          testStatus = res.ok ? "passed" : "failed";
          io.emit({ event_type: "verification_result", actor_type: "evaluator", payload: { check: "tests", status: testStatus } });
        }
        io.emit({ event_type: "step_completed", actor_type: "agent", payload: { step_id: step.id, tool: toolName, ok: res.ok } });
      }
      io.emit({ event_type: "step_completed", actor_type: "agent", payload: { step_id: step.id } });
    }

    // ---- verification phase ----
    io.emit({ event_type: "phase_changed", actor_type: "system", payload: { phase: "verify" } });
    io.emit({ event_type: "verification_started", actor_type: "evaluator", payload: {} });

    if (opts.mode === "failing_tests" && testStatus !== "failed") {
      testStatus = "failed"; // fixture-simulated evaluator failure
    }    if (testStatus === "failed") {
      if (repairRounds < budget.max_retries) {
        repairRounds++;
        io.emit({ event_type: "phase_changed", actor_type: "system", payload: { phase: "repair", round: repairRounds } });
        // MVP deterministic repair: re-run the test tool once more (template loop is bounded)
        throwIfCancelled();
        const impl = TOOLS["run_tests"];
        if (!impl) return finish("failed", "UNKNOWN_TOOL");
        toolCalls++;
        const res = await impl.run(ctxFor("run_tests"), { command: "npm test" });
        // fixture mode keeps the simulated failure through the repair round
        testStatus = opts.mode === "failing_tests" ? "failed" : res.ok ? "passed" : "failed";
        io.emit({ event_type: "verification_result", actor_type: "evaluator", payload: { check: "tests", status: testStatus, round: repairRounds } });
      }
      if (testStatus === "failed") {
        return finish("needs_repair", "TESTS_FAILED");
      }
    }

    return finish("ready_for_review", null);
  } catch (err) {
    if (err instanceof CancelledError) {
      io.emit({ event_type: "run_cancelled", actor_type: "user", payload: {} });
      return finish("cancelled", null);
    }
    if (opts.mode === "provider_timeout") {
      io.emit({ event_type: "run_failed", actor_type: "system", payload: { reason: "provider timeout" } });
      return finish("failed", "PROVIDER_TIMEOUT");
    }
    io.emit({ event_type: "run_failed", actor_type: "system", payload: { reason: msg(err) } });
    return finish("failed", "INTERNAL_ERROR");
  }

  async function finish(status: ExecuteOutcome["status"], failureCode: string | null): Promise<ExecuteOutcome> {
    const diff = await ws.diff();
    const changed = await ws.changedFiles();
    const hash = await ws.hashAll();
    const finalStatus = status === "ready_for_review" && diff.files.length === 0 && opts.mode !== "failing_tests"
      ? "failed"  // claimed work with no change: honest failure, not a fake success
      : status;
    io.emit({
      event_type: finalStatus === "ready_for_review" ? "run_completed" : "run_failed",
      actor_type: "system",
      payload: { status: finalStatus, changed_files: changed.length, failure_code: failureCode },
    });
    // workspace retained for review; caller destroys after integration/abandon
    return {
      status: finalStatus,
      failure_code: failureCode,
      changedFiles: changed,
      diff,
      workspaceHash: hash,
      toolCallsUsed: toolCalls,
    };
  }
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Deterministic tool inputs per step id (MVP executor semantics). */
function toolInputFor(
  toolName: string,
  stepId: string,
  opts: ExecuteOptions,
  testStatus: "not_run" | "passed" | "failed"
): Record<string, unknown> {
  switch (toolName) {
    case "list_tree":
      return { path: "" };
    case "read_file":
      return { path: "package.json" };
    case "search":
      return { query: stepId === "s1" ? "export function" : "TODO" };
    case "edit_file": {
      // Grounded, bounded change: extend lib/greet.ts + tests in the fixture.
      if (stepId === "s2") {
        return {
          path: "lib/greet.ts",
          action: "append",
          content:
            "\nexport function loginGreeting(user: string): string {\n  const safe = user.trim();\n  if (!safe) return \"Welcome back, guest.\";\n  return `Welcome back, ${safe}.`;\n}\n",
        };
      }
      if (stepId === "s3") {
        return {
          path: "tests/greet.test.ts",
          action: "append",
          content:
            '\nimport { loginGreeting } from "../lib/greet.ts";\n\ntest("login greeting welcomes the user", () => {\n  assert.equal(loginGreeting("Ada"), "Welcome back, Ada.");\n});\n\ntest("login greeting falls back to guest", () => {\n  assert.equal(loginGreeting("  "), "Welcome back, guest.");\n});\n',
        };
      }
      return { path: "untouched.txt", action: "create", content: "" };
    }
    case "run_tests":
      return { command: "npm test" };
    case "compute_diff":
      return {};
    default:
      return {};
  }
}
