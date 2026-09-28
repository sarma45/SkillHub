/**
 * Idea → structured task brief compiler (deterministic).
 *
 * The cockpit's plan approval is hash-bound (a stale plan hash is a 409), so
 * the front of the funnel must be reproducible too: the same idea text always
 * compiles to the same CreateTaskRequest. This module is pure — no LLM, no
 * I/O, no imports beyond the contracts — and every field it derives is shown
 * with the rule that produced it (provenance, not magic).
 *
 * Risk is never auto-set above "high": raising to "critical" stays a human
 * decision in the UI.
 */
import type { CreateTaskRequest } from "@cockpit/contracts";

export type Risk = CreateTaskRequest["risk"];

export interface CompiledIdea {
  /** Exactly what POST /api/v1/projects/:id/tasks accepts. */
  brief: CreateTaskRequest;
  /** Provenance for the preview UI: which rule produced what. */
  provenance: Array<{ field: string; rule: string }>;
  /** First sentence, trimmed — display only. */
  title: string;
}

/** Keywords that raise risk. Ordered: first match wins. */
const HIGH_RISK = [
  "payment", "billing", "auth", "authentication", "password", "encrypt",
  "production", "deploy", "migration", "migrate", "delete", "gdpr", "compliance",
];
const MEDIUM_RISK = [
  "login", "user data", "api", "integration", "database", "webhook",
  "notification", "email", "export", "import",
];

const DOMAIN_HINTS: Array<[string, string[]]> = [
  ["web-app", ["website", "web app", "dashboard", "landing", "saas", "frontend", "next"]],
  ["mobile-app", ["mobile", "ios", "android", "app store"]],
  ["api-service", ["api", "endpoint", "backend", "microservice", "webhook"]],
  // automation before data-pipeline: cron/bot/schedule are stronger intent
  // signals than incidental words like "reports".
  ["automation", ["automate", "workflow", "bot", "schedule", "cron"]],
  ["data-pipeline", ["pipeline", "etl", "analytics", "report", "dataset", "scrape"]],
];

function sentences(text: string): string[] {
  return text
    .split(/[\n;•]+|\.\s+/)
    .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter((s) => s.length >= 3);
}

export function extractTitle(idea: string): string {
  const first = sentences(idea)[0] ?? idea.trim();
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

export function deriveRisk(idea: string): { risk: Risk; rule: string } {
  const lower = idea.toLowerCase();
  if (HIGH_RISK.some((k) => lower.includes(k))) {
    return { risk: "high", rule: "mentions auth / payments / production / destructive data ops" };
  }
  if (MEDIUM_RISK.some((k) => lower.includes(k))) {
    return { risk: "medium", rule: "mentions external data, integrations, or user-facing flows" };
  }
  return { risk: "low", rule: "no high- or medium-risk keywords detected" };
}

export function deriveDomain(idea: string): string {
  const lower = idea.toLowerCase();
  for (const [domain, hints] of DOMAIN_HINTS) {
    if (hints.some((k) => lower.includes(k))) return domain;
  }
  return "general";
}

export function deriveCriteria(idea: string): { criteria: string[]; rule: string } {
  const derived = sentences(idea)
    .filter((s) => /^(the |it |a |an )?(user|system|app|customer|admin)/i.test(s) || /\b(works?|shows?|loads?|sends?|stores?|allows?|displays?)\b/i.test(s))
    .slice(0, 10);
  if (derived.length > 0) {
    return { criteria: derived, rule: `${derived.length} actionable sentence(s) extracted from the idea` };
  }
  return {
    criteria: ["The idea works end-to-end as described in the brief"],
    rule: "no actionable sentences detected — single safe default criterion (editable before send)",
  };
}

export function deriveNonGoals(idea: string): { nonGoals: string[]; rule: string } {
  const stated = sentences(idea)
    .filter((s) => /\b(not|don'?t|do not|no need|exclude|except)\b/i.test(s))
    .map((s) => (s.length > 200 ? `${s.slice(0, 197)}…` : s))
    .slice(0, 10);
  if (stated.length > 0) {
    return { nonGoals: stated, rule: `${stated.length} exclusion statement(s) found in the idea` };
  }
  return {
    nonGoals: ["Anything beyond the stated success criteria"],
    rule: "no exclusions stated — scope guard default (editable before send)",
  };
}

/** Deterministic: same input ⇒ identical output (deep-equal, field order included). */
export function compileIdeaToBrief(idea: string): CompiledIdea {
  const text = idea.trim();
  if (text.length < 8) {
    throw new Error("idea too short: at least 8 characters required by the task contract");
  }
  const { risk, rule: riskRule } = deriveRisk(text);
  const { criteria, rule: critRule } = deriveCriteria(text);
  const { nonGoals, rule: nonGoalRule } = deriveNonGoals(text);
  return {
    title: extractTitle(text),
    brief: {
      request: text.slice(0, 4000),
      success_criteria: criteria,
      non_goals: nonGoals,
      risk,
    },
    provenance: [
      { field: "request", rule: "idea text verbatim (trimmed, ≤4000 chars)" },
      { field: "success_criteria", rule: critRule },
      { field: "non_goals", rule: nonGoalRule },
      { field: "risk", rule: riskRule },
      { field: "domain", rule: `classified as ${deriveDomain(text)}` },
    ],
  };
}
