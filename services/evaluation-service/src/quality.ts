/**
 * Quality evaluators (Phase 6/7 — open-seo, diagram-design, open-design
 * patterns). Three real, deterministic evaluators over a run's changed
 * files:
 *
 *  - seo-basics:        title/meta/heading/alt/landmark discipline for HTML/TSX
 *  - diagram-coherence: mermaid/svg diagrams have labels, structure, no orphans
 *  - design-coherence:  token usage (no hardcoded colors), semantics, a11y basics
 *
 * Each evaluator produces a typed finding list with severity and evidence
 * refs; the caller turns them into evidence rows (verified, human_required
 * stays false — these are heuristic checks, labeled as such).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type Severity = "informational" | "low" | "medium" | "high" | "critical";

export interface QualityFinding {
  evaluator: "seo-basics" | "diagram-coherence" | "design-coherence";
  severity: Severity;
  message: string;
  file: string;
  line: number | null;
}

export interface QualityReport {
  findings: QualityFinding[];
  files_scanned: number;
  evaluators_run: string[];
}

const UI_EXT = /\.(tsx|jsx|html|astro|vue|svelte)$/i;
const DOC_EXT = /\.(md|markdown|mdx)$/i;

async function readIfSmall(abs: string): Promise<string | null> {
  try {
    const stat = await fs.stat(abs);
    if (stat.size > 512 * 1024) return null;
    return await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }
}

// ---------- seo-basics (open-seo) ----------

function seoCheck(rel: string, content: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const isHtml = /\.html?$/i.test(rel);
  const isTsx = /\.tsx?$/i.test(rel);

  if (isHtml) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(content);
    if (!title || title[1]!.trim().length < 5) {
      findings.push({ evaluator: "seo-basics", severity: "medium", message: "missing or too-short <title> (aim for 15–60 chars)", file: rel, line: 1 });
    }
    if (!/<meta[^>]+name=["']description["']/i.test(content)) {
      findings.push({ evaluator: "seo-basics", severity: "medium", message: "missing <meta name=description>", file: rel, line: 1 });
    }
    const h1s = content.match(/<h1\b/gi);
    if (!h1s || h1s.length === 0) {
      findings.push({ evaluator: "seo-basics", severity: "low", message: "no <h1> heading found", file: rel, line: 1 });
    } else if (h1s.length > 1) {
      findings.push({ evaluator: "seo-basics", severity: "low", message: `multiple <h1> headings (${h1s.length})`, file: rel, line: 1 });
    }
    for (const m of content.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) {
      findings.push({ evaluator: "seo-basics", severity: "medium", message: "<img> without alt attribute", file: rel, line: lineOf(content, m.index ?? 0) });
    }
  }

  if (isTsx) {
    // metadata export in Next.js pages
    if (/export\s+default\s+function/.test(content) && !/metadata\s*=|generateMetadata|<title|Head\b/.test(content)) {
      findings.push({
        evaluator: "seo-basics",
        severity: "informational",
        message: "page component without metadata/title hook (informational; layout may supply it)",
        file: rel,
        line: 1,
      });
    }
    for (const m of content.matchAll(/<img\s(?![^>]*\balt=)[^>]*>/gi)) {
      findings.push({ evaluator: "seo-basics", severity: "medium", message: "<img> without alt attribute", file: rel, line: lineOf(content, m.index ?? 0) });
    }
  }
  return findings;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

// ---------- diagram-coherence (diagram-design) ----------

function diagramCheck(rel: string, content: string): QualityFinding[] {
  const findings: QualityFinding[] = [];

  // mermaid blocks
  for (const m of content.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    const block = m[1] ?? "";
    const startLine = lineOf(content, m.index ?? 0);
    const nodeIds = new Set<string>();
    for (const nm of block.matchAll(/(?:^|\n)\s*([A-Za-z0-9_]+)\s*(?:\[|\(|\{ |--|>|\.)/g)) nodeIds.add(nm[1]!);
    const declared = new Set<string>();
    for (const dm of block.matchAll(/(?:^|\n)\s*([A-Za-z0-9_]+)\s*(?:\[|\(|\{)/g)) declared.add(dm[1]!);
    const referenced = new Set<string>();
    for (const rm of block.matchAll(/--[-x.]?>|-\.-?>/g)) void rm; // edges exist
    for (const em of block.matchAll(/([A-Za-z0-9_]+)\s*--[-x.]?>\s*([A-Za-z0-9_]+)/g)) {
      referenced.add(em[1]!);
      referenced.add(em[2]!);
    }
    // orphan nodes: declared but in no edge and alone on their line
    const orphans = [...declared].filter((d) => !referenced.has(d));
    if (orphans.length > 0) {
      findings.push({
        evaluator: "diagram-coherence",
        severity: "low",
        message: `mermaid diagram has ${orphans.length} disconnected node(s): ${orphans.slice(0, 4).join(", ")}`,
        file: rel,
        line: startLine,
      });
    }
    // unlabeled edges
    const unlabeled = [...block.matchAll(/([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)/g)].filter(
      (e) => !/\|/.test(e[0] ?? "")
    );
    if (unlabeled.length > 3) {
      findings.push({
        evaluator: "diagram-coherence",
        severity: "informational",
        message: `mermaid diagram has ${unlabeled.length} unlabeled edges — label the ones that carry meaning`,
        file: rel,
        line: startLine,
      });
    }
    if (nodeIds.size > 12) {
      findings.push({
        evaluator: "diagram-coherence",
        severity: "low",
        message: `mermaid diagram has ${nodeIds.size} nodes — consider splitting into subgraphs`,
        file: rel,
        line: startLine,
      });
    }
  }

  // inline svg in UI code: missing title/desc hurts both SEO and a11y
  const svg = /<svg\b[^>]*>([\s\S]*?)<\/svg>/gi;
  for (const m of content.matchAll(svg)) {
    const inner = m[1] ?? "";
    if (!/<title[\s>]/i.test(inner)) {
      findings.push({
        evaluator: "diagram-coherence",
        severity: "medium",
        message: "inline <svg> without <title> (screen readers and diagram readers both need it)",
        file: rel,
        line: lineOf(content, m.index ?? 0),
      });
    }
  }
  return findings;
}

// ---------- design-coherence (open-design + no-ai-slop) ----------

const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/;
const ALLOWED_COLOR_FILES = /(tokens|theme|colors?|palette|variables)/i;

function designCheck(rel: string, content: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!UI_EXT.test(rel) && !/\.css$/i.test(rel)) return findings;

  // hardcoded colors outside token definitions
  if (!ALLOWED_COLOR_FILES.test(rel)) {
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      const stripped = line.replace(/\/\/.*$/, "");
      if (HARDCODED_COLOR.test(stripped) && !/var\(--/.test(stripped)) {
        findings.push({
          evaluator: "design-coherence",
          severity: "medium",
          message: `hardcoded color outside token files — use var(--token) (found: ${stripped.trim().slice(0, 60)})`,
          file: rel,
          line: i + 1,
        });
      }
    });
  }

  // AI-slop tells in copy
  for (const m of content.matchAll(/\b(seamlessly|supercharge|unleash|revolutionize|game-changer|cutting-edge)\b/gi)) {
    findings.push({
      evaluator: "design-coherence",
      severity: "low",
      message: `marketing-slop wording in UI copy: "${m[0]}" — say what it does instead`,
      file: rel,
      line: lineOf(content, m.index ?? 0),
    });
  }

  // clickable divs (a11y + semantics)
  for (const m of content.matchAll(/<div[^>]*onClick/gi)) {
    findings.push({
      evaluator: "design-coherence",
      severity: "medium",
      message: "clickable <div onClick> — use <button> for semantics and keyboard access",
      file: rel,
      line: lineOf(content, m.index ?? 0),
    });
  }

  return findings;
}

// ---------- public API ----------

export async function evaluateChangedFilesQuality(changedFiles: string[], workspaceRoot: string): Promise<QualityReport> {
  const findings: QualityFinding[] = [];
  let scanned = 0;

  for (const rel of changedFiles.slice(0, 50)) {
    const abs = path.resolve(workspaceRoot, rel);
    // confine to workspace
    if (!abs.startsWith(path.resolve(workspaceRoot))) continue;
    const content = await readIfSmall(abs);
    if (content === null) continue;
    scanned++;
    findings.push(...seoCheck(rel, content));
    findings.push(...diagramCheck(rel, content));
    findings.push(...designCheck(rel, content));
  }

  return {
    findings,
    files_scanned: scanned,
    evaluators_run: ["seo-basics", "diagram-coherence", "design-coherence"],
  };
}

/** Markdown docs in a repo also get diagram + (light) design checks. */
export function docEvaluatorsApply(rel: string): boolean {
  return DOC_EXT.test(rel);
}
