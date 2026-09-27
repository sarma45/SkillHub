import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, seed, getSkill } from "@cockpit/db";
import { extractSkillCandidate, reviewCandidate, listCandidates } from "../src/index.js";
import type { ExtractionSource } from "../src/index.js";

let db: ReturnType<typeof openDb>;
const ORG = "org_local";
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "extract-"));
  db = openDb(path.join(dir, "t.db"));
  seed(db);
});
afterAll(() => db.close());

const MIT_DOC = `# How to Review a Pull Request

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software to deal in the Software without restriction.

## When to use this
- When a teammate requests review on a bounded change
- When CI is green but semantics need human judgment

## Workflow
1. Read the diff top to bottom before any file comment
2. Run the tests locally in an isolated workspace
3. Verify evidence labels match what actually ran
4. Comment with scope, reason, and recovery path
5. Approve only when success criteria are observable

## finally
Record the decision in project memory.`;

describe("skill-extraction pipeline (book-to-skill)", () => {
  it("extracts a candidate from inline text with exact license detection", async () => {
    const src: ExtractionSource = { kind: "text", text: MIT_DOC, title: "pr-review-method" };
    const { candidate, row, requiresReview } = await extractSkillCandidate(db, ORG, src);

    expect(requiresReview).toBe(true);
    expect(row.status).toBe("candidate");
    expect(candidate.license).toBe("MIT");
    expect(candidate.license_confidence).toBe("exact");
    expect(candidate.workflow_steps.length).toBeGreaterThanOrEqual(3);
    expect(candidate.triggers.length).toBeGreaterThanOrEqual(1);
    expect(candidate.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.content_chars).toBeGreaterThan(200);
  });

  it("lands candidates in the registry and human review promotes them", async () => {
    const { row } = await extractSkillCandidate(db, ORG, {
      kind: "text",
      text: MIT_DOC,
      title: "review-method-two",
    });
    expect(listCandidates(db, ORG).length).toBeGreaterThanOrEqual(2);

    // promote to reviewed, then approve
    const reviewed = reviewCandidate(db, ORG, row.skill_id, "promote_reviewed");
    expect(reviewed.status).toBe("reviewed");
    const approved = reviewCandidate(db, ORG, row.skill_id, "approve");
    expect(approved.status).toBe("approved");
  });

  it("redacts secrets from source before extraction and warns", async () => {
    const leaky = MIT_DOC + "\n\ntoken = ghp_abcdefghijklmnopqrstuvwxyz0123456789\n";
    const { candidate } = await extractSkillCandidate(db, ORG, {
      kind: "text",
      text: leaky,
      title: "leaky-method",
    });
    expect(candidate.warnings.some((w) => /secrets detected and redacted/.test(w))).toBe(true);
    expect(candidate.source_sha256).not.toBe(
      (await import("node:crypto")).createHash("sha256").update(leaky).digest("hex")
    );
  });

  it("warns when no license is detectable", async () => {
    const { candidate } = await extractSkillCandidate(db, ORG, {
      kind: "text",
      text: [
        "# Some Method",
        "",
        "Do things carefully and always verify the outcome before you claim success.",
        "",
        "## Procedure",
        "",
        "1. step one: read the surrounding code and note the conventions",
        "2. step two: apply the smallest change that could work",
        "3. step three: run the test suite and attach the output as evidence",
        "4. step four: record a decision receipt for every non-obvious choice",
      ].join("\n"),
      title: "unlicensed-method",
    });
    expect(candidate.license).toBeNull();
    expect(candidate.warnings.some((w) => /no license detected/.test(w))).toBe(true);
  });

  it("rejects sources too short to be a skill", async () => {
    await expect(
      extractSkillCandidate(db, ORG, { kind: "text", text: "too short", title: "tiny" })
    ).rejects.toThrow(/too short/);
  });

  it("extracts from a directory of markdown docs", async () => {
    const docDir = path.join(dir, "docs-src");
    mkdirSync(docDir, { recursive: true });
    writeFileSync(path.join(docDir, "guide.md"), MIT_DOC.replace("pr-review-method", "dir-method"));
    writeFileSync(path.join(docDir, "extra.md"), "## Extra rules\n\n1. Always verify evidence\n2. Never trust claims without receipts\n3. Label everything\n");
    const { candidate } = await extractSkillCandidate(db, ORG, { kind: "directory", path: docDir });
    expect(candidate.source_refs.length).toBe(2);
    expect(candidate.workflow_steps.length).toBeGreaterThanOrEqual(3);
    expect(getSkill(db, ORG, candidate.skill_id)).toBeTruthy();
  });
});
