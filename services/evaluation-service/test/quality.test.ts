import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluateChangedFilesQuality } from "../src/index.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "quality-"));
});
afterAll(() => { /* tmp cleanup */ });

function write(rel: string, content: string): string {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return rel;
}

describe("quality evaluators (seo / diagram / design)", () => {
  it("flags missing title, meta description, and alt attributes in HTML", async () => {
    const rel = write("site/page.html", '<html><body><h2>hi</h2><img src="x.png"></body></html>');
    const report = await evaluateChangedFilesQuality([rel], dir);
    const seo = report.findings.filter((f) => f.evaluator === "seo-basics");
    expect(seo.some((f) => /<title>/.test(f.message))).toBe(true);
    expect(seo.some((f) => /meta name=description/.test(f.message))).toBe(true);
    expect(seo.some((f) => /img.*without alt|<img> without alt/i.test(f.message))).toBe(true);
    expect(report.files_scanned).toBe(1);
  });

  it("flags svg without title and disconnected mermaid nodes", async () => {
    const rel = write(
      "ui/badge.tsx",
      `export const Badge = () => (
  <svg width="10"><rect x="0"/></svg>
);`
    );
    const docRel = write(
      "docs/flow.md",
      `\`\`\`mermaid
graph TD
  A[Alone]
  B[Start] --> C[End]
\`\`\`
`
    );
    const report = await evaluateChangedFilesQuality([rel, docRel], dir);
    expect(report.findings.some((f) => f.evaluator === "diagram-coherence" && /svg.*without <title>/i.test(f.message))).toBe(true);
    expect(report.findings.some((f) => f.evaluator === "diagram-coherence" && /disconnected node/.test(f.message))).toBe(true);
  });

  it("flags hardcoded colors, slop wording, and clickable divs", async () => {
    const rel = write(
      "ui/card.tsx",
      `export const Card = () => (
  <div onClick={() => {}} style={{ color: '#ff00ff' }}>
    Supercharge your workflow seamlessly
  </div>
);`
    );
    const report = await evaluateChangedFilesQuality([rel], dir);
    const design = report.findings.filter((f) => f.evaluator === "design-coherence");
    expect(design.some((f) => /hardcoded color/.test(f.message))).toBe(true);
    expect(design.some((f) => /slop/.test(f.message))).toBe(true);
    expect(design.some((f) => /clickable <div/.test(f.message))).toBe(true);
  });

  it("allows tokens and clean components", async () => {
    const rel = write(
      "ui/clean.tsx",
      `export const Clean = () => (
  <button style={{ color: 'var(--accent)' }}>Run tests</button>
);`
    );
    const report = await evaluateChangedFilesQuality([rel], dir);
    expect(report.findings.filter((f) => f.file === rel)).toHaveLength(0);
  });

  it("tokens/theme files are exempt from the hardcoded-color rule", async () => {
    const rel = write("ui/tokens.css", ":root { --accent: #4f8cff; }");
    const report = await evaluateChangedFilesQuality([rel], dir);
    expect(report.findings.filter((f) => f.evaluator === "design-coherence")).toHaveLength(0);
  });

  it("confines scans to the workspace root", async () => {
    const report = await evaluateChangedFilesQuality(["../outside.ts"], dir);
    expect(report.files_scanned).toBe(0);
  });
});
