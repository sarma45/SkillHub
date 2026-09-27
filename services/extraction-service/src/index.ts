/**
 * Skill-extraction pipeline (Phase 4/9 — book-to-skill + open-notebook
 * patterns): turns a source document or repository into a structured
 * candidate skill with full provenance, then routes it through human
 * review before it can be activated.
 *
 * Pipeline (master prompt §6B):
 *   source → license/provenance scan → structure inventory → candidate
 *   workflow extraction → contract normalization → HUMAN REVIEW →
 *   versioned registry entry
 *
 * Nothing extracted is ever auto-activated: candidates land with status
 * "candidate" and a human promotes them to "reviewed"/"approved" (skills
 * page or API).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { upsertSkill, getSkill, newEntityId, type SkillRow } from "@cockpit/db";
import { redactSecrets } from "@cockpit/policy";

export const EXTRACTION_POLICY_VERSION = "1.0.0";

export interface ExtractedCandidate {
  skill_id: string;
  name: string;
  purpose: string;
  category: string;
  triggers: string[];
  inputs: string[];
  outputs: string[];
  workflow_steps: string[];
  forbidden_actions: string[];
  source_refs: string[];
  source_sha256: string;
  license: string | null;
  license_confidence: "exact" | "inferred" | "unknown";
  warnings: string[];
  content_chars: number;
}

// ---------- license detection (exact match first, then inference) ----------

const LICENSE_HINTS: Array<{ id: string; marker: RegExp; confidence: "exact" | "inferred" }> = [
  { id: "MIT", marker: /Permission is hereby granted, free of charge, to any person obtaining a copy/i, confidence: "exact" },
  { id: "Apache-2.0", marker: /Apache License\s+Version 2\.0/i, confidence: "exact" },
  { id: "BSD-3-Clause", marker: /Redistribution and use in source and binary forms/i, confidence: "inferred" },
  { id: "GPL-3.0", marker: /GNU GENERAL PUBLIC LICENSE\s+Version 3/i, confidence: "exact" },
  { id: "ISC", marker: /ISC License|Permission to use, copy, modify, and\/or distribute this software/i, confidence: "inferred" },
  { id: "CC-BY-4.0", marker: /Creative Commons Attribution 4\.0/i, confidence: "exact" },
];

function detectLicense(text: string): { license: string | null; confidence: "exact" | "inferred" | "unknown" } {
  for (const l of LICENSE_HINTS) {
    if (l.marker.test(text)) return { license: l.id, confidence: l.confidence };
  }
  if (/copyright|©/i.test(text)) return { license: null, confidence: "inferred" };
  return { license: null, confidence: "unknown" };
}

// ---------- content fetching: local path, file, or inline text ----------

export type ExtractionSource =
  | { kind: "text"; text: string; title: string }
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

async function loadSource(src: ExtractionSource): Promise<{ text: string; refs: string[] }> {
  if (src.kind === "text") return { text: src.text, refs: [`inline:${src.title}`] };
  if (src.kind === "file") {
    const text = await fs.readFile(path.resolve(src.path), "utf-8");
    return { text, refs: [path.resolve(src.path)] };
  }
  // directory: concatenate markdown/text docs (bounded)
  const root = path.resolve(src.path);
  const files = await listDocs(root);
  let text = "";
  const refs: string[] = [];
  for (const f of files.slice(0, 20)) {
    const raw = await fs.readFile(f, "utf-8");
    text += `\n\n<!-- from ${path.relative(root, f)} -->\n` + raw.slice(0, 40_000);
    refs.push(path.relative(root, f));
    if (text.length > 200_000) break;
  }
  return { text: text.slice(0, 200_000), refs };
}

async function listDocs(dir: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      out.push(...(await listDocs(abs, depth + 1)));
    } else if (/\.(md|markdown|txt|rst)$/i.test(e.name)) {
      out.push(abs);
    }
  }
  return out.sort();
}

// ---------- structure inventory + candidate extraction ----------

interface Section {
  heading: string;
  level: number;
  body: string;
}

function inventory(text: string): { sections: Section[]; codeBlocks: number; lists: number; hasSteps: boolean } {
  const sections: Section[] = [];
  const lines = text.split("\n");
  let current: Section | null = null;
  let codeBlocks = 0;
  let lists = 0;
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      if (inCode) codeBlocks++;
      continue;
    }
    if (inCode) {
      if (current) current.body += line + "\n";
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      current = { heading: (h[2] ?? "").trim(), level: h[1]?.length ?? 1, body: "" };
      sections.push(current);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) lists++;
    if (current) current.body += line + "\n";
  }
  const hasSteps = /\b(step \d|first|then|finally|workflow|procedure)\b/i.test(text);
  return { sections, codeBlocks, lists, hasSteps };
}

function extractPurpose(text: string, title: string): string {
  // first paragraph under the first heading, else first non-empty lines
  const inv = inventory(text);
  const first = inv.sections.find((s) => s.body.trim().length > 40);
  const raw = first ? first.body.trim().split("\n\n")[0]! : text.trim().split("\n").slice(0, 3).join(" ");
  const clean = raw.replace(/\s+/g, " ").slice(0, 200);
  return clean.length > 20 ? clean : `${title} workflow`;
}

function extractTriggers(text: string): string[] {
  const triggers = new Set<string>();
  const when = /(?:when|use this|use these|trigger|apply this)[^\n.]{5,90}/gi;
  for (const m of text.matchAll(when)) triggers.add(m[0].replace(/\s+/g, " ").trim().slice(0, 90));
  const inv = inventory(text);
  for (const s of inv.sections.slice(0, 4)) {
    if (/^(when|usage|triggers?|how to use)/i.test(s.heading)) {
      for (const line of s.body.split("\n")) {
        const t = line.replace(/^\s*[-*]\s*/, "").trim();
        if (t.length > 8 && t.length < 90) triggers.add(t);
      }
    }
  }
  return [...triggers].slice(0, 6);
}

function extractSteps(text: string): string[] {
  const steps: string[] = [];
  const numbered = /^\s*(\d+)[.)]\s+(.{8,120})$/gm;
  for (const m of text.matchAll(numbered)) steps.push((m[2] ?? '').replace(/\s+/g, " ").trim());
  if (steps.length < 2) {
    // fall back to imperative headings
    const inv = inventory(text);
    for (const s of inv.sections) {
      if (/^(step|how|implement|run|verify|install|configure)/i.test(s.heading) && s.heading.length < 90) {
        steps.push(s.heading);
      }
    }
  }
  return steps.slice(0, 10);
}

// ---------- the pipeline ----------

export async function extractSkillCandidate(
  db: DB,
  orgId: string,
  src: ExtractionSource,
  opts: { category?: string; skillIdHint?: string } = {}
): Promise<{ candidate: ExtractedCandidate; row: SkillRow; requiresReview: true }> {
  const { text, refs } = await loadSource(src);
  if (text.trim().length < 200) {
    throw Object.assign(new Error("source too short to extract a skill (min 200 chars)"), { code: "DOMAIN_VALIDATION_FAILED" });
  }

  const red = redactSecrets(text);
  const scanned = red.redacted;
  const warnings: string[] = [];
  if (red.changed) warnings.push("secrets detected and redacted in source before extraction");

  const license = detectLicense(scanned);
  if (license.confidence === "unknown") warnings.push("no license detected — treat as all-rights-reserved; do not redistribute");
  if (license.confidence === "inferred") warnings.push(`license inferred, not confirmed (${license.license ?? "copyright-only"})`);

  const inv = inventory(scanned);
  if (!inv.hasSteps && inv.lists < 2) warnings.push("no clear workflow steps detected — candidate may be reference material, not a procedure");

  const title =
    src.kind === "text" ? src.title : path.basename(src.kind === "file" ? src.path : src.path);
  const purpose = extractPurpose(scanned, title);
  const triggers = extractTriggers(scanned);
  const steps = extractSteps(scanned);

  const skillId = (opts.skillIdHint ?? slugify(title) ?? "extracted-skill") + "-x";
  const sourceSha = createHash("sha256").update(scanned).digest("hex");

  const candidate: ExtractedCandidate = {
    skill_id: skillId,
    name: titleCase(title),
    purpose,
    category: opts.category ?? "content-pattern",
    triggers: triggers.length ? triggers : [`working with ${title.toLowerCase()}`],
    inputs: ["task context", "source document reference"],
    outputs: ["skill run receipt", "applied workflow steps"],
    workflow_steps: steps,
    forbidden_actions: ["external_submit", "runtime activation before review"],
    source_refs: refs,
    source_sha256: sourceSha,
    license: license.license,
    license_confidence: license.confidence,
    warnings,
    content_chars: scanned.length,
  };

  // land as CANDIDATE: human review is the gate to reviewed/approved
  const row = upsertSkill(db, {
    organization_id: orgId,
    skill_id: candidate.skill_id,
    version: "0.1.0",
    name: candidate.name,
    purpose: candidate.purpose,
    source_repo: null,
    source_url: null,
    source_commit: candidate.source_sha256.slice(0, 12),
    license: candidate.license,
    category: candidate.category,
    phase: 4,
    manifest_json: JSON.stringify({
      ...candidate,
      status: "candidate",
      extracted_by: "extraction-service",
      extraction_policy_version: EXTRACTION_POLICY_VERSION,
    }),
    status: "candidate",
    owner: "extraction-pipeline",
  });

  return { candidate, row, requiresReview: true };
}

// ---------- human review transitions ----------

export function reviewCandidate(db: DB, orgId: string, skillId: string, decision: "approve" | "reject" | "promote_reviewed"): SkillRow {
  const row = getSkill(db, orgId, skillId);
  if (!row) throw Object.assign(new Error("skill not found"), { code: "NOT_FOUND" });
  if (row.status === "approved" && decision !== "reject") {
    throw Object.assign(new Error("skill is already approved"), { code: "STATE_CONFLICT" });
  }
  const nextStatus = decision === "approve" ? "approved" : decision === "reject" ? "deprecated" : "reviewed";
  db.prepare("UPDATE skills SET status = ?, owner = ? WHERE organization_id = ? AND skill_id = ?").run(
    nextStatus,
    decision === "approve" ? "platform-team" : "human-review",
    orgId,
    skillId
  );
  return getSkill(db, orgId, skillId)!;
}

export function listCandidates(db: DB, orgId: string): SkillRow[] {
  return db
    .prepare("SELECT * FROM skills WHERE organization_id = ? AND status IN ('candidate') ORDER BY created_at DESC")
    .all(orgId) as SkillRow[];
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "extracted"
  );
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}
