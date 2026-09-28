import { getRunById, getTaskById, getRunDiff, getRunEvidence, getPrDraft, getTaskPlans } from "@/server/app-layer";
import { scorePlan } from "@/lib/plan-trust";
import { scoreOutcome } from "@/lib/outcome-trust";
import { RunTrustSummary } from "./run-trust-summary";
import type { PlanDocument } from "@cockpit/contracts";
import { Card, KeyValue, Button, EmptyState } from "@cockpit/ui/components";
import { StatusBadge, EvidenceLabelBadge, RiskBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { PrDraftPanel } from "./pr-draft-panel";
import { requirePageSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function RunReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  await requirePageSession();
  const { runId } = await params;
  const run = getRunById(runId);
  const task = getTaskById(run.task_id);
  const diff = (await getRunDiff(runId)) as {
    files: Array<{ path: string; patch: string; bytes_added: number; bytes_removed: number }>;
    total_bytes: number;
  };
  const evidence = getRunEvidence(runId) as Array<{
    id: string; check_type: string; status: string; severity: string; label: string; command_or_method: string; result: Record<string, unknown>; human_required: boolean;
  }>;
  const draft = getPrDraft(runId);
  const blocking = evidence.filter((e) => e.status === "failed" && ["high", "critical"].includes(e.severity));
  // Trust across the lifecycle: approval-time plan score vs receipt-derived outcome.
  const planRow = getTaskPlans(task.id);
  const planTrust = planRow ? scorePlan(JSON.parse(planRow.plan_json) as PlanDocument) : null;
  const outcome = scoreOutcome(evidence);

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Review {run.id.slice(-8)}</h1>
          <div className="row">
            <StatusBadge status={run.status} />
            <RiskBadge risk={task.risk} />
          </div>
        </div>
        <Link href={`/app/runs/${runId}/live`}>← Live run</Link>
      </header>

      <Card title="Summary">
        <KeyValue
          items={[
            ["Requested", task.request_text],
            ["Changed files", String(diff.files?.length ?? 0)],
            ["Diff size", `${diff.total_bytes ?? 0} bytes`],
            ["Failure", run.failure_code ?? "none"],
          ]}
        />
      </Card>

      <RunTrustSummary planTrust={planTrust} outcome={outcome} />

      {run.status !== "ready_for_review" && run.status !== "awaiting_integration_approval" && (
        <EmptyState
          title={`Run is ${run.status.replace(/_/g, " ")}`}
          body="Review opens when the run reaches ready_for_review. Cancelled and failed runs keep their receipts for inspection."
          action={<Link href={`/app/runs/${runId}/live`}><Button>Open live run</Button></Link>}
        />
      )}

      <Card title="Diff (isolated workspace vs pristine copy)">
        {diff.files?.length ? (
          diff.files.map((f) => (
            <details key={f.path} style={{ marginBottom: 12 }}>
              <summary style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                {f.path} <span style={{ color: "var(--ok)" }}>+{f.bytes_added}</span>{" "}
                <span style={{ color: "var(--err)" }}>-{f.bytes_removed}</span>
              </summary>
              <pre className="diff">
                {f.patch.split("\n").map((line, i) => (
                  <div key={i} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : "ctx"}>
                    {line}
                  </div>
                ))}
              </pre>
            </details>
          ))
        ) : (
          <p className="hint">No changed files recorded.</p>
        )}
      </Card>

      <Card title="Evidence">
        {evidence.length === 0 ? (
          <p className="hint">Evidence is recorded by the evaluation worker; refresh once the run completes.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Check", "Status", "Severity", "Label", "Method", "Human required"].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)" }}>{e.check_type}</td>
                  <td style={{ padding: "6px 10px" }}><StatusBadge status={e.status} /></td>
                  <td style={{ padding: "6px 10px" }}>{e.severity}</td>
                  <td style={{ padding: "6px 10px" }}><EvidenceLabelBadge label={e.label} /></td>
                  <td style={{ padding: "6px 10px", color: "var(--text-dim)" }}>{e.command_or_method}</td>
                  <td style={{ padding: "6px 10px" }}>{e.human_required ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(run.status === "ready_for_review" || run.status === "awaiting_integration_approval") && (
        <Card title="Pull-request draft">
          <PrDraftPanel
            runId={runId}
            hasBlocking={blocking.length > 0}
            existing={draft as { draft_id: string; status: string; payload: Record<string, unknown> } | null}
          />
        </Card>
      )}
    </>
  );
}
