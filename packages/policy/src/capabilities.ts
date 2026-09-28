/**
 * Capability flags (master prompt "Capability flag rules"). Server-side
 * authority: a dormant capability has no reachable API behavior. The web
 * layer must call assertCapabilityEnabled before executing any gated route.
 */

export type CapabilityStatus = "dormant" | "internal" | "beta" | "enabled";

export interface Capability {
  capability_id: string;
  status: CapabilityStatus;
  required_phase: number;
  required_permissions: string[];
  note: string;
}

export const CAPABILITIES: readonly Capability[] = [
  // ---- MVP enabled ----
  { capability_id: "repo.local_import", status: "enabled", required_phase: 1, required_permissions: ["project:read"], note: "Import a local repository read-only." },
  { capability_id: "repo.fixture_import", status: "enabled", required_phase: 1, required_permissions: ["project:read"], note: "Import a bundled safe fixture repository." },
  { capability_id: "map.generate", status: "enabled", required_phase: 1, required_permissions: ["project:read"], note: "Generate the editable repository map." },
  { capability_id: "plan.generate", status: "enabled", required_phase: 2, required_permissions: ["task:write"], note: "Generate a versioned plan from a task brief." },
  { capability_id: "plan.approve", status: "enabled", required_phase: 2, required_permissions: ["plan:approve"], note: "Approve a plan version by hash." },
  { capability_id: "run.execute", status: "enabled", required_phase: 3, required_permissions: ["run:execute"], note: "Execute an approved plan in an isolated workspace." },
  { capability_id: "run.control", status: "enabled", required_phase: 3, required_permissions: ["run:control"], note: "Pause, resume, cancel a run." },
  { capability_id: "evidence.evaluate", status: "enabled", required_phase: 3, required_permissions: ["artifact:read"], note: "Run build/type/test/secret/changed-file evaluators." },
  { capability_id: "integration.pr_draft", status: "enabled", required_phase: 3, required_permissions: ["integration:submit"], note: "Create a pull-request draft after human approval of the exact payload." },
  { capability_id: "security.local_fixture_scan", status: "enabled", required_phase: 3, required_permissions: ["security:scan"], note: "Baseline + Strix scans against the local vulnerable-app fixture only." },
  { capability_id: "security.diff_scan", status: "enabled", required_phase: 3, required_permissions: ["security:scan"], note: "Diff-scoped scan of the isolated workspace change." },

  // ---- Phase 4+ features now ACTIVE (working implementations, not mocks) ----
  { capability_id: "memory.service", status: "enabled", required_phase: 4, required_permissions: ["memory:write"], note: "Scoped project memory: agent saves start unapproved; human approval gates influence; inspect/edit/export/delete in the Memory page." },
  { capability_id: "context.bundle", status: "enabled", required_phase: 4, required_permissions: ["project:read"], note: "Hierarchical budgeted context assembly feeding the planner and the autonomous agent." },
  { capability_id: "browser.verify", status: "enabled", required_phase: 6, required_permissions: ["browser:use"], note: "Real headless Edge/Chrome via CDP; loopback-only allowlist; screenshots + console/HTTP evidence." },
  { capability_id: "run.autonomous", status: "enabled", required_phase: 4, required_permissions: ["run:execute"], note: "Model-driven tool-use loop behind the same policy gates; final tests forced; every call receipted." },
  { capability_id: "providers.multi", status: "enabled", required_phase: 5, required_permissions: ["project:read"], note: "Provider catalog with deterministic routing (Anthropic, OpenAI, offline fallbacks). Routing decisions are recorded as receipts." },

  // ---- Dormant until later phases (master prompt "Dormant until a later phase") ----
  { capability_id: "repo.github", status: "dormant", required_phase: 8, required_permissions: ["integration:submit"], note: "Remote GitHub import/write. Dormant: local + fixtures only in MVP." },
  { capability_id: "integration.github_submit", status: "dormant", required_phase: 8, required_permissions: ["integration:submit"], note: "Actually open a PR on GitHub. Dormant: drafts are local-only in MVP." },
  { capability_id: "decision.jev", status: "dormant", required_phase: 5, required_permissions: [], note: "Jev typed decision layer. Dormant; deterministic policy only." },
  { capability_id: "security.remote_target", status: "dormant", required_phase: 9, required_permissions: ["security:scan"], note: "Scans beyond local fixtures. Dormant; requires scope manifest infra." },
  { capability_id: "skills.marketplace", status: "dormant", required_phase: 9, required_permissions: [], note: "Public skill marketplace. Dormant." },
  { capability_id: "skills.dynamic_extraction", status: "enabled", required_phase: 4, required_permissions: [], note: "book-to-skill extraction is active; extracted skills stay candidates until a human approves them." },
  { capability_id: "agents.swarm", status: "dormant", required_phase: 9, required_permissions: [], note: "Multi-agent swarms. Dormant; single-agent loop only." },
  { capability_id: "deploy.autonomous", status: "dormant", required_phase: 9, required_permissions: [], note: "Any deployment execution. Dormant; not built." },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.capability_id, c]));

export function isCapabilityEnabled(id: string): boolean {
  return BY_ID.get(id)?.status === "enabled";
}

export class CapabilityDisabledError extends Error {
  constructor(public readonly capability_id: string) {
    super(`Capability ${capability_id} is not enabled`);
    this.name = "CapabilityDisabledError";
  }
}

export function assertCapabilityEnabled(id: string): void {
  if (!isCapabilityEnabled(id)) throw new CapabilityDisabledError(id);
}

export function listCapabilities(): Capability[] {
  return [...CAPABILITIES];
}
