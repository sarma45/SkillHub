/**
 * Outcome scorer tests — arithmetic over real receipt shapes.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { scoreOutcome, type EvidenceReceipt } from "../src/lib/outcome-trust";

const receipt = (over: Partial<EvidenceReceipt> = {}): EvidenceReceipt => ({
  check_type: "tests",
  status: "passed",
  severity: "warning",
  label: "test suite",
  human_required: false,
  ...over,
});

describe("outcome scorer", () => {
  it("scores a clean, complete receipt set HIGH", () => {
    const t = scoreOutcome([
      receipt({ check_type: "tests" }),
      receipt({ check_type: "secrets" }),
      receipt({ check_type: "changed_file_review", status: "passed", human_required: false }),
      receipt({ check_type: "quality:seo-basics" }),
    ]);
    expect(t.overall).toBeGreaterThanOrEqual(85);
    expect(t.confidence).toBe("HIGH");
    expect(t.receipts).toBe(4);
  });

  it("severity weights make a failed critical dominate (mixed sets)", () => {
    const mild = scoreOutcome([
      receipt({ severity: "informational", status: "failed" }),
      receipt(),
    ]);
    const grave = scoreOutcome([
      receipt({ severity: "critical", status: "failed" }),
      receipt(),
    ]);
    expect(grave.overall).toBeLessThan(mild.overall);
  });

  it("warnings earn half credit, failures none", () => {
    const t = scoreOutcome([receipt({ status: "warning" })]);
    expect(t.components.find((c) => c.key === "checks")!.score).toBe(50);
    expect(scoreOutcome([receipt({ status: "failed" })]).components.find((c) => c.key === "checks")!.score).toBe(0);
  });

  it("coverage rewards distinct receipt families and caps at 100", () => {
    const t = scoreOutcome([
      receipt({ check_type: "tests" }),
      receipt({ check_type: "secrets" }),
      receipt({ check_type: "changed_file_review" }),
      receipt({ check_type: "quality:a" }),
      receipt({ check_type: "quality:b" }),
      receipt({ check_type: "quality:c" }),
      receipt({ check_type: "quality:d" }),
    ]);
    expect(t.components.find((c) => c.key === "coverage")!.score).toBe(100);
  });

  it("outstanding human checkpoints zero the axis; settled ones pass", () => {
    const outstanding = scoreOutcome([receipt({ human_required: true, status: "warning" })]);
    expect(outstanding.components.find((c) => c.key === "human")!.score).toBe(0);
    const settled = scoreOutcome([receipt({ human_required: true, status: "passed" })]);
    expect(settled.components.find((c) => c.key === "human")!.score).toBe(100);
  });

  it("empty evidence is honest: zero receipts, LOW confidence", () => {
    const t = scoreOutcome([]);
    expect(t.receipts).toBe(0);
    expect(t.overall).toBe(0);
    expect(t.confidence).toBe("LOW");
  });

  it("is deterministic for identical receipt sets", () => {
    const set = [
      receipt({ check_type: "tests" }),
      receipt({ check_type: "secrets", status: "warning" }),
    ];
    expect(JSON.stringify(scoreOutcome(set))).toBe(JSON.stringify(scoreOutcome(set)));
  });
});
