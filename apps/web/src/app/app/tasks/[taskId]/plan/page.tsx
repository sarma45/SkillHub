import { getTaskById, getTaskPlans, listTaskRuns } from "@/server/app-layer";
import { Card, KeyValue, Button, PhaseStepper } from "@cockpit/ui/components";
import { RiskBadge, StatusBadge, EvidenceLabelBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { PlanActions } from "./plan-actions";
import { StartRunForm } from "./start-run-form";
import type { PlanDocument } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

const PHASES = ["Framed", "Planned", "Awaiting approval", "Executing", "Verifying", "Review"];

export default async function TaskPlanPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = getTaskById(taskId);
  const brief = JSON.parse(task.brief_json) as { request: string; success_criteria: string[]; non_goals: string[]; risk: string };
  const plan = getTaskPlans(taskId);
  const runs = listTaskRuns(taskId);
  const planDoc = plan ? (JSON.parse(plan.plan_json) as PlanDocument) : null;

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Task</h1>
          <p className="page-sub" style={{ maxWidth: 720 }}>{brief.request}</p>
          <div className="row">
            <RiskBadge risk={brief.risk} />
            <StatusBadge status={task.state.toLowerCase()} />
          </div>
        </div>
        <Link href={`/app/projects/${task.project_id}/overview`}>← Project</Link>
      </header>

      <PhaseStepper phases={PHASES} current={phaseFor(task.state, plan?.status)} />

      <div className="grid-2" style={{ marginTop: 24 }}>
        <div>
          <Card title="Brief">
            <KeyValue
              items={[
                ["Request", brief.request],
                ["Risk", <RiskBadge key="r" risk={brief.risk} />],
              ]}
            />
            <h3 style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16 }}>Success criteria</h3>
            <ul>{brief.success_criteria.map((c) => <li key={c}>{c}</li>)}</ul>
            {brief.non_goals.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16 }}>Non-goals</h3>
                <ul>{brief.non_goals.map((c) => <li key={c}>{c}</li>)}</ul>
              </>
            )}
          </Card>

          {runs.length > 0 && (
            <Card title="Runs">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {runs.map((r) => (
                  <li key={r.id} className="row spread" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 10, background: "var(--surface-2)" }}>
                    <Link href={`/app/runs/${r.id}/live`} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                      {r.id}
                    </Link>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div>
          {!planDoc ? (
            <Card title="Plan">
              <p className="hint">
                No plan yet. {task.state === "FRAMED" ? "Generate one — the worker produces a dependency-aware plan from the map." : ""}
              </p>
              {task.state === "FRAMED" && <PlanActions taskId={taskId} mode="generate" />}
            </Card>
          ) : (
            <Card
              title={`Plan v${plan!.version}`}
              actions={<StatusBadge status={plan!.status === "proposed" ? "queued" : plan!.status} />}
            >
              <KeyValue
                items={[
                  ["Goal", planDoc.goal],
                  ["Plan hash", <code key="h" style={{ fontSize: 11, wordBreak: "break-all" }}>{plan!.plan_hash.slice(0, 24)}…</code>],
                  ["Budget", `${planDoc.budget.max_tool_calls} tool calls · ${planDoc.budget.max_retries} retries · ${Math.round(planDoc.budget.max_duration_ms / 1000)}s`],
                ]}
              />

              <h3 style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16 }}>Steps</h3>
              <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}>
                {planDoc.steps.map((s) => (
                  <li key={s.id}>
                    <div style={{ fontWeight: 600 }}>{s.title}</div>
                    <div className="hint">
                      tools: {s.tools.join(", ") || "—"}
                      {s.affected_files.length > 0 ? ` · files: ${s.affected_files.join(", ")}` : ""}
                    </div>
                    {s.verification.length > 0 && (
                      <div className="hint">verification: {s.verification.join("; ")}</div>
                    )}
                    {s.depends_on.length > 0 && <div className="hint">depends on: {s.depends_on.join(", ")}</div>}
                  </li>
                ))}
              </ol>

              <h3 style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16 }}>Assumptions</h3>
              <ul style={{ paddingLeft: 20 }}>
                {planDoc.assumptions.map((a) => (
                  <li key={a.text}>
                    {a.text} <EvidenceLabelBadge label={`confidence ${a.confidence}`} />
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: 20 }}>
                <PlanActions
                  taskId={taskId}
                  mode={plan!.status === "proposed" && task.state === "AWAITING_PLAN_APPROVAL" ? "approve" : "view"}
                  planVersion={plan!.version}
                  planHash={plan!.plan_hash}
                />
              </div>

              {plan!.status === "approved" && task.state === "EXECUTING" && (
                <Card title="Execute">
                  <StartRunForm taskId={taskId} planHash={plan!.plan_hash} />
                </Card>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function phaseFor(state: string, planStatus?: string): string {
  if (state === "FRAMED") return "Planned";
  if (state === "AWAITING_PLAN_APPROVAL") return "Awaiting approval";
  if (state === "EXECUTING") return "Executing";
  if (state === "VERIFYING" || state === "NEEDS_REPAIR") return "Verifying";
  if (state === "READY_FOR_REVIEW" || state === "AWAITING_INTEGRATION_APPROVAL") return "Review";
  if (state === "INTEGRATED") return "Review";
  return "Framed";
}
