export * from "./catalog.js";

import type { CatalogEntry } from "./catalog.js";
import { SKILL_CATALOG } from "./catalog.js";

/**
 * Runtime binding rule (master prompt §6B): the agent receives ONLY approved
 * skills. Reviewed/candidate/catalog entries are data for humans, not
 * instructions for the model.
 */
export function runtimeSkills(entries: CatalogEntry[] = SKILL_CATALOG): CatalogEntry[] {
  return entries.filter((e) => e.manifest.status === "approved");
}

/** §6B phase table rendered by the UI from live data. */
export function phaseBindings(entries: CatalogEntry[] = SKILL_CATALOG): Array<{
  phase: number;
  repos: string[];
  capability: string;
  module: string;
}> {
  const byPhase = new Map<number, string[]>();
  for (const e of entries) {
    const p = e.manifest.phase;
    if (p === null) continue;
    (byPhase.get(p) ?? byPhase.set(p, []).get(p)!).push(e.manifest.source_repo ?? e.manifest.id);
  }
  const modules: Record<number, [string, string]> = {
    0: ["Jobs-to-be-Done, discovery, harness principles", "product-contract"],
    1: ["Hierarchical context, repository understanding", "context-service"],
    2: ["Skill contracts, plan artifacts", "planning-service, skill-engine"],
    3: ["Harness loop, hooks, tool use", "execution-engine, tool-gateway"],
    4: ["Context hierarchy, memory lifecycle", "memory-service"],
    5: ["Provider catalog, routing, fallback", "decision-service, model-gateway"],
    6: ["Accessibility, pentesting, web quality", "evaluation-service, security-service"],
    7: ["Design direction, tokens, human review", "review-ui, design-system"],
    8: ["CI, API integration, release gates", "integration-service, audit-service"],
    9: ["Evaluation loops, improvement governance", "evaluation-service, skill-registry"],
  };
  return [...byPhase.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, repos]) => ({
      phase,
      repos: [...new Set(repos)].sort(),
      capability: modules[phase]?.[0] ?? "",
      module: modules[phase]?.[1] ?? "",
    }));
}
