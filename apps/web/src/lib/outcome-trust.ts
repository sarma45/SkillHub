/**
 * Outcome scoring (objective #6 continued): reliability of what actually
 * happened, derived deterministically from the run's evidence receipts — the
 * records the engine already writes. No model, no opinions: the arithmetic
 * below is the whole story, and each axis states its rule.
 *
 * Paired with the plan trust score, review shows the contract:
 *   plan trust = how well-specified the intent was at approval time
 *   outcome    = what the receipts say actually happened
 * The delta is displayed, never interpreted for the human.
 */
export interface EvidenceReceipt {
  check_type: string;
  status: string; // passed | failed | warning | ...
  severity: string; // informational | warning | high | critical
  label: string;
  human_required: boolean;
}

export interface OutcomeScore {
  overall: number; // 0-100
  confidence: "LOW" | "MEDIUM" | "HIGH";
  components: Array<{ key: string; label: string; score: number; rule: string }>;
  /** How many receipts informed the score (0 ⇒ honest unknown). */
  receipts: number;
}

export function scoreOutcome(evidence: EvidenceReceipt[]): OutcomeScore {
  const n = evidence.length;

  // Weights by severity: a failed critical receipt dominates a failed note.
  const severityWeight = (s: string): number =>
    s === "critical" ? 3 : s === "high" ? 2.5 : s === "warning" ? 1.5 : 1;

  const wTotal = evidence.reduce((sum, e) => sum + severityWeight(e.severity), 0);
  const passed = evidence.filter((e) => e.status === "passed");
  const wPassed = passed.reduce((sum, e) => sum + severityWeight(e.severity), 0);
  // Warnings earn partial credit; failures earn none.
  const wPartial = evidence
    .filter((e) => e.status === "warning")
    .reduce((sum, e) => sum + severityWeight(e.severity) * 0.5, 0);

  const checks = wTotal === 0 ? 0 : Math.round(((wPassed + wPartial) / wTotal) * 100);

  const humanOutstanding = evidence.filter((e) => e.human_required && e.status !== "passed").length;
  // "no receipts" is not "all settled" — an empty record scores zero here.
  const human = n === 0 ? 0 : humanOutstanding === 0 ? 100 : 0;

  const coverage = (() => {
    const types = new Set(evidence.map((e) => e.check_type));
    // Canonical receipt families the engine produces: tests, secrets,
    // changed-file review (+ any quality evaluators that ran).
    const quality = [...types].filter((t) => t.startsWith("quality:")).length;
    const core = ["tests", "secrets", "changed_file_review"].filter((t) => types.has(t)).length;
    return Math.min(100, core * 30 + quality * 10);
  })();

  const components = [
    {
      key: "checks",
      label: "Receipt outcomes",
      score: checks,
      rule: `${passed.length}/${n} receipt(s) passed, severity-weighted (warnings earn half credit)`,
    },
    {
      key: "coverage",
      label: "Verification coverage",
      score: coverage,
      rule: `${[...new Set(evidence.map((e) => e.check_type))].length} distinct receipt type(s); core families (tests/secrets/changed-file review) ×30, quality evaluators ×10, cap 100`,
    },
    {
      key: "human",
      label: "Human checkpoints",
      score: human,
      rule: n === 0 ? "no receipts recorded — nothing verified yet" : humanOutstanding === 0 ? "no receipts still awaiting a human decision" : `${humanOutstanding} receipt(s) await human action`,
    },
  ];

  const overall = Math.round((checks * 0.6 + coverage * 0.3 + human * 0.1) * 10) / 10;
  const confidence = overall >= 85 ? "HIGH" : overall >= 65 ? "MEDIUM" : "LOW";
  return { overall, confidence, components, receipts: n };
}
