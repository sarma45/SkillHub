/**
 * Planning service (Phase 2 "Plan"). Generates a dependency-aware,
 * verification-bearing plan from the task brief + repository map.
 * MVP is deterministic (template planner over the repo map); the model
 * gateway seam exists for the Anthropic adapter without changing contracts.
 */
import type { PlanDocument, PlanStep, RepositoryMap } from "@cockpit/contracts";
import { planHash } from "@cockpit/policy";
import type { ModelGatewayPort } from "@cockpit/model-gateway";
import { MockModelAdapter } from "@cockpit/model-gateway";
import { newEntityId } from "@cockpit/db";

export interface PlanInput {
  brief: {
    request: string;
    success_criteria: string[];
    non_goals: string[];
    risk: "low" | "medium" | "high" | "critical";
  };
  repoMap: RepositoryMap;
  /** Real context bundle (context-service) — provenance-labeled layers. */
  contextSummary?: string;
}

/**
 * Deterministic planner: infers the bounded change surface from the brief and
 * the repository map. Every plan carries verification steps and a budget.
 */
export function generatePlanDeterministic(input: PlanInput): PlanDocument {
  const { brief, repoMap } = input;
  const targetDir = inferTargetDir(brief.request, repoMap);
  const isUi = mentionsUi(brief.request);
  const testFile = inferTestFile(targetDir);

  const steps: PlanStep[] = [
    {
      id: "s1",
      title: `Read existing code in ${targetDir} to ground the change`,
      depends_on: [],
      tools: ["read_file", "search", "list_tree"],
      expected_outputs: ["grounding notes in run events"],
      verification: ["target files exist in workspace"],
      affected_files: [],
      human_checkpoint: false,
    },
    {
      id: "s2",
      title: `Implement the bounded change for: ${brief.request.slice(0, 120)}`,
      depends_on: ["s1"],
      tools: ["edit_file"],
      expected_outputs: [`${targetDir}/<new-or-edited files>`],
      verification: ["diff contains only planned files"],
      affected_files: [`${targetDir}/`],
      human_checkpoint: false,
    },
    {
      id: "s3",
      title: "Add or extend tests covering the change",
      depends_on: ["s2"],
      tools: ["edit_file"],
      expected_outputs: [testFile],
      verification: ["at least one assertion per success criterion"],
      affected_files: [testFile],
      human_checkpoint: false,
    },
    {
      id: "s4",
      title: "Run the test suite and record evidence",
      depends_on: ["s3"],
      tools: ["run_tests", "compute_diff"],
      expected_outputs: ["test evidence receipt", "workspace diff"],
      verification: [`${repoMap.test_command ?? "npm test"} exits 0`],
      affected_files: [],
      human_checkpoint: false,
    },
  ];

  return {
    goal: brief.request,
    success_criteria: brief.success_criteria,
    non_goals: brief.non_goals,
    assumptions: [
      {
        text: `Change is confined to ${targetDir} and ${testFile}`,
        confidence: 0.7,
        source: "repo map + brief",
      },
      {
        text: `Repository is ${repoMap.framework ?? "unclassified"}; tests run via ${repoMap.test_command ?? "npm test"}`,
        confidence: repoMap.test_command ? 0.9 : 0.4,
        source: "repository map",
      },
      ...(input.contextSummary
        ? [
            {
              text: `Context bundle (${input.contextSummary.length} chars) grounded this plan; see run context receipt`,
              confidence: 0.8,
              source: "context-service",
            },
          ]
        : []),
    ],
    steps,
    risk: brief.risk,
    approval_points: ["plan approval before execution", "review before integration"],
    budget: {
      max_cost_usd: brief.risk === "critical" ? 5 : 2,
      max_duration_ms: 900_000,
      max_retries: 2,
      max_tool_calls: 300,
    },
  };
}

/** Async seam used by the application layer; MVP resolves deterministically. */
export async function generatePlan(
  input: PlanInput,
  model: ModelGatewayPort = new MockModelAdapter()
): Promise<{ plan: PlanDocument; plan_hash: string; provider: string; context_summary: string | null }> {
  // Record a model receipt for auditability even in deterministic mode.
  await model.complete({
    purpose: "planning",
    system: "You produce bounded engineering plans. This run is deterministic-template backed.",
    user: input.brief.request,
    max_tokens: 64,
  });
  const plan = generatePlanDeterministic(input);
  return { plan, plan_hash: planHash(plan), provider: model.route, context_summary: input.contextSummary ?? null };
}

// ---------- heuristics ----------

function inferTargetDir(request: string, map: RepositoryMap): string {
  const r = request.toLowerCase();
  const has = (p: string): boolean => map.tree.children?.some((c: { path: string; name: string }) => c.path === p || c.name === p) ?? false;
  if (r.includes("login") || r.includes("auth")) return "src/auth";
  if (r.includes("api") || r.includes("endpoint")) return has("app") ? "app/api" : "src/api";
  if (isUiRequest(r)) return has("app") ? "app" : "src/components";
  return has("src") ? "src" : ".";
}

function isUiRequest(r: string): boolean {
  return mentionsUi(r);
}

function mentionsUi(request: string): boolean {
  const r = request.toLowerCase();
  return /page|form|button|component|ui|screen|layout|dashboard/.test(r);
}

function inferTestFile(targetDir: string): string {
  if (targetDir.startsWith("app")) return "tests/app.test.tsx";
  if (targetDir.startsWith("src/auth")) return "tests/auth.test.ts";
  if (targetDir.startsWith("src/api")) return "tests/api.test.ts";
  return "tests/changed.test.ts";
}
