import { getRunById, getTaskById, getRunEvents } from "@/server/app-layer";
import { Card, Button, PhaseStepper, KeyValue } from "@cockpit/ui/components";
import { StatusBadge, RiskBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { RunControls } from "./run-controls";
import { LiveEvents } from "./live-events";

export const dynamic = "force-dynamic";

const PHASES = ["Execute", "Verify", "Repair", "Review"];

export default async function RunLivePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRunById(runId);
  const task = getTaskById(run.task_id);
  const events = getRunEvents(runId, 0);

  const phase =
    run.status === "verifying" || run.status === "needs_repair"
      ? run.status === "needs_repair" ? "Repair" : "Verify"
      : run.status === "ready_for_review" || run.status === "awaiting_integration_approval" || run.status === "integrated"
        ? "Review"
        : "Execute";

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Run {run.id.slice(-8)}</h1>
          <div className="row">
            <StatusBadge status={run.status} />
            <RiskBadge risk={task.risk} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
              model: {run.model_route}
            </span>
          </div>
        </div>
        <Link href={`/app/tasks/${task.id}/plan`}>← Task</Link>
      </header>

      <PhaseStepper phases={PHASES} current={phase} />

      <div className="grid-2" style={{ marginTop: 24 }}>
        <div>
          <Card title="Run">
            <KeyValue
              items={[
                ["Plan hash", <code key="h" style={{ fontSize: 11, wordBreak: "break-all" }}>{run.plan_hash.slice(0, 24)}…</code>],
                ["Started", run.started_at ?? "—"],
                ["Budget used", (run.budget_used_json as unknown as string) || "{}"],
                ["Failure", run.failure_code ?? "none"],
              ]}
            />
          </Card>

          <Card title="Controls">
            {run.status === "ready_for_review" ? (
              <Link href={`/app/runs/${runId}/review`}>
                <Button variant="primary">Open review</Button>
              </Link>
            ) : (
              <RunControls runId={runId} status={run.status} />
            )}
            <p className="hint">
              Cancellation preserves the run record, receipts, and workspace for inspection (TRD §7.4).
            </p>
          </Card>
        </div>

        <Card title="Timeline (tool receipts, redacted)">
          <LiveEvents
            runId={runId}
            initialCursor={0}
            initialEvents={events as Array<{ sequence: number; event_type: string; actor_type: string; payload: Record<string, unknown>; created_at: string }>}
            terminal={["ready_for_review", "failed", "cancelled", "needs_repair", "integrated"].includes(run.status)}
          />
        </Card>
      </div>
    </>
  );
}
