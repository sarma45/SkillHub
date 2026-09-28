import type { PlanTrustScore } from "@/lib/plan-trust";

function band(score: number): { color: string; bg: string } {
  if (score >= 85) return { color: "var(--ok)", bg: "rgba(62,207,142,.18)" };
  if (score >= 65) return { color: "var(--warn)", bg: "rgba(230,180,85,.18)" };
  return { color: "var(--err)", bg: "rgba(239,106,106,.18)" };
}

/**
 * Trust panel (iteration 3): deterministic reliability scores for the plan at
 * the moment of approval. Every bar shows the rule that produced it — scores
 * are arguments, not vibes.
 */
export function TrustPanel({ score }: { score: PlanTrustScore }) {
  const b = band(score.overall);
  return (
    <div
      style={{
        border: `1px solid ${b.color}44`,
        background: b.bg,
        borderRadius: "var(--radius-md)",
        padding: 16,
        display: "grid",
        gap: 12,
      }}
    >
      <div className="row spread" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Plan trust: {score.overall}</strong>
        <span
          className="badge"
          style={{ color: b.color, background: "transparent", border: `1px solid ${b.color}66`, borderRadius: 999, padding: "1px 10px", fontSize: 12, fontWeight: 600 }}
        >
          {score.confidence}
        </span>
      </div>

      {score.components.map((c) => {
        const cb = band(c.score);
        return (
          <div key={c.key} style={{ display: "grid", gap: 4 }}>
            <div className="row spread" style={{ gap: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--text)" }}>{c.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: cb.color }}>{c.score}</span>
            </div>
            <div
              role="meter"
              aria-valuenow={c.score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${c.label}: ${c.score} of 100`}
              style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}
            >
              <div style={{ width: `${c.score}%`, height: "100%", background: cb.color, transition: "width var(--dur-fast) var(--ease)" }} />
            </div>
            <span className="hint" style={{ marginTop: 0 }}>{c.rule}</span>
          </div>
        );
      })}

      <span className="hint" style={{ marginTop: 0 }}>
        Deterministic heuristic scoring — same plan, same score. It informs your approval; it never replaces it.
      </span>
    </div>
  );
}
