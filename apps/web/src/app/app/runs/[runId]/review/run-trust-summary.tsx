import type { PlanTrustScore } from "@/lib/plan-trust";
import type { OutcomeScore } from "@/lib/outcome-trust";

function band(score: number): string {
  if (score >= 85) return "var(--ok)";
  if (score >= 65) return "var(--warn)";
  return "var(--err)";
}

/**
 * Trust across the lifecycle (iteration 4): the plan's approval-time score
 * beside the run's receipt-derived outcome score. The delta is displayed as
 * arithmetic, not interpretation — what the human does with it is theirs.
 */
export function RunTrustSummary({
  planTrust,
  outcome,
}: {
  planTrust: PlanTrustScore | null;
  outcome: OutcomeScore;
}) {
  const delta = planTrust ? Math.round((outcome.overall - planTrust.overall) * 10) / 10 : null;
  const deltaColor = delta === null ? "var(--text-dim)" : delta >= 0 ? "var(--ok)" : "var(--warn)";

  return (
    <div className="grid-2" style={{ marginTop: 24 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: 16,
          background: "var(--surface)",
          display: "grid",
          gap: 6,
        }}
      >
        <span className="hint" style={{ margin: 0 }}>Plan trust (at approval)</span>
        {planTrust ? (
          <>
            <div className="row" style={{ gap: 8 }}>
              <strong style={{ fontSize: 22, color: band(planTrust.overall) }}>{planTrust.overall}</strong>
              <span
                className="badge"
                style={{ color: band(planTrust.overall), border: `1px solid ${band(planTrust.overall)}66`, borderRadius: 999, padding: "1px 10px", fontSize: 11, fontWeight: 600 }}
              >
                {planTrust.confidence}
              </span>
            </div>
            <span className="hint" style={{ margin: 0 }}>
              {planTrust.components.find((c) => c.key === "verification")?.rule}
            </span>
          </>
        ) : (
          <span className="hint" style={{ margin: 0 }}>plan not available for this run</span>
        )}
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: 16,
          background: "var(--surface)",
          display: "grid",
          gap: 6,
        }}
      >
        <span className="hint" style={{ margin: 0 }}>Outcome (from {outcome.receipts} receipt{outcome.receipts === 1 ? "" : "s"})</span>
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: 22, color: band(outcome.overall) }}>{outcome.overall}</strong>
          <span
            className="badge"
            style={{ color: band(outcome.overall), border: `1px solid ${band(outcome.overall)}66`, borderRadius: 999, padding: "1px 10px", fontSize: 11, fontWeight: 600 }}
          >
            {outcome.confidence}
          </span>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          {outcome.components.find((c) => c.key === "checks")?.rule}
        </span>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-dim)" }}>
          outcome − plan =
        </span>
        {delta === null ? (
          <span className="hint" style={{ margin: 0 }}>n/a (no plan score)</span>
        ) : (
          <strong style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: deltaColor }}>
            {delta > 0 ? "+" : ""}{delta}
          </strong>
        )}
        <span className="hint" style={{ margin: 0 }}>
          deterministic arithmetic over receipts and plan structure — advisory only
        </span>
      </div>
    </div>
  );
}
