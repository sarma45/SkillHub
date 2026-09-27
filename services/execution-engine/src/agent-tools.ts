/**
 * Agent-only tools for the autonomous loop (Phase 3+): memory write and real
 * browser verification. Same typed-contract discipline as tools.ts: scopes
 * enforced in code, deny-by-default, redacted receipts.
 *
 *  - remember        → memory-service (agent saves start UNAPPROVED; human
 *                      approval is the checkpoint before they influence runs)
 *  - browser_verify  → browser-service REAL headless Edge/Chrome over CDP;
 *                      loopback allowlist enforced before launch
 */
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import type { ToolContract, ToolResult } from "@cockpit/contracts";
import { remember } from "@cockpit/memory-service";
import { capturePage } from "@cockpit/browser-service";
import type { ToolContext, ToolImplementation } from "./tools.js";
import { workspaceBaseDir } from "./paths.js";

function result(ok: boolean, summary: string, bytes: number, outputRef: string | null = null): ToolResult {
  return { ok, summary: summary.slice(0, 2000), bytes, output_ref: outputRef };
}

const rememberInput = {
  type: "object",
  properties: {
    content: { type: "string", description: "The memory content to save (plain sentence)." },
    kind: { type: "string", enum: ["fact", "preference", "decision", "lesson"] },
    scope: { type: "string", enum: ["project", "task", "team", "user"] },
    confidence: { type: "number" },
    source_refs: { type: "array", items: { type: "string" } },
  },
  required: ["content", "kind"],
} as const;

const browserInput = {
  type: "object",
  properties: {
    url: { type: "string", description: "Loopback http(s) URL to open and verify (e.g. http://localhost:3000/app)." },
    expect_text: { type: "string", description: "Optional text that must appear on the page." },
  },
  required: ["url"],
} as const;

export interface AgentToolDeps {
  db: DB;
  organizationId: string;
  projectId: string;
  runId: string;
  /** injected by worker/app so the tool can persist the PNG as an artifact */
  onScreenshot?: (absolutePngPath: string) => Promise<string | null>;
}

export function makeRememberTool(deps: AgentToolDeps): ToolImplementation {
  return {
    contract: {
      name: "remember",
      description:
        "Save a scoped memory (fact/preference/decision/lesson) for future runs. Agent-written memories require human approval before they influence later runs.",
      input_schema: rememberInput,
      output_schema: { type: "object" },
      side_effects: ["write_memory"],
      risk_level: "low",
      required_scopes: ["memory:write"],
      undo_strategy: "memory can be expired or hard-deleted by the user in the Memory page",
      timeout_ms: 5_000,
      idempotency: "not_idempotent" as const,
    },
    async run(ctx, input) {
      // scope check identical to core tools
      const missing = ["memory:write"].filter((s) => !ctx.grantedScopes.includes(s as never));
      if (missing.length > 0) {
        const err = new Error(`Tool remember denied: missing scopes [${missing.join(", ")}]`);
        err.name = "ToolScopeDenied";
        throw err;
      }
      ctx.throwIfCancelled();
      const content = String(input.content ?? "").slice(0, 2000);
      if (!content.trim()) return result(false, "remember: empty content rejected", 0);
      const { row, requiresApproval } = remember(deps.db, {
          organizationId: deps.organizationId,
          projectId: deps.projectId,
          runId: deps.runId,
          scope: (input.scope as "project" | "task" | "team" | "user") ?? "project",
          kind: (input.kind as "fact" | "preference" | "decision" | "lesson") ?? "fact",
          content,
          sourceRefs: (input.source_refs as string[]) ?? [`run:${deps.runId}`],
          confidence: typeof input.confidence === "number" ? input.confidence : 0.6,
          createdBy: "agent",
        });
      ctx.receipt({
        tool: "remember",
        memory_id: row.id,
        kind: row.kind,
        scope: row.scope,
        requires_human_approval: requiresApproval,
      });
      return result(
        true,
        `saved ${row.kind} memory ${row.id} (status: ${requiresApproval ? "awaiting human approval" : "active"})`,
        content.length
      );
    },
  };
}

export function makeBrowserVerifyTool(deps: AgentToolDeps): ToolImplementation {
  return {
    contract: {
      name: "browser_verify",
      description:
        "Open a loopback URL in a real headless browser (local Edge/Chrome via CDP), capture a PNG screenshot, and record console errors / HTTP failures.",
      input_schema: browserInput,
      output_schema: { type: "object" },
      side_effects: ["browser_launch"],
      risk_level: "medium",
      required_scopes: ["browser:use"],
      undo_strategy: "browser process is killed after capture; user-data-dir removed",
      timeout_ms: 45_000,
      idempotency: "not_idempotent" as const,
    },
    async run(ctx, input) {
      const missing = ["browser:use"].filter((s) => !ctx.grantedScopes.includes(s as never));
      if (missing.length > 0) {
        const err = new Error(`Tool browser_verify denied: missing scopes [${missing.join(", ")}]`);
        err.name = "ToolScopeDenied";
        throw err;
      }
      ctx.throwIfCancelled();
      const url = String(input.url ?? "");
      const expectText = input.expect_text ? String(input.expect_text) : null;
      const captureId = `cap_${deps.runId.replace(/^run_/, "")}_${Date.now().toString(36)}`;
      const outDir = path.join(workspaceBaseDir(), "_captures");

      const capture = await capturePage({ url, outDir, captureId, settleMs: 2500 });

      if (!capture.ok) {
        ctx.receipt({ tool: "browser_verify", url, failed: capture.error });
        return result(false, `browser capture failed: ${capture.error}`, 0);
      }

      const artifactId = capture.screenshot_path
        ? await deps.onScreenshot?.(capture.screenshot_path)
        : null;

      const errors = capture.page_errors.length + capture.http_failures.length;
      const textOk = expectText ? (capture.title ?? "").includes(expectText) : true;

      ctx.receipt({
        tool: "browser_verify",
        url: capture.url,
        title: capture.title,
        screenshot_artifact: artifactId,
        console_errors: capture.page_errors.length,
        http_failures: capture.http_failures.length,
      });

      const verdict = errors === 0 && textOk ? "pass" : "issues-found";
      return result(
        verdict === "pass",
        `browser ${verdict}: title="${capture.title ?? "?"}" console_errors=${capture.page_errors.length} http_failures=${capture.http_failures.length}${expectText ? ` expect_text=${textOk ? "found" : "MISSING"}` : ""}`,
        errors,
        artifactId
      );
    },
  };
}

export const AGENT_TOOL_NAMES = ["remember", "browser_verify"] as const;
