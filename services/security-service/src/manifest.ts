/**
 * Scope manifest + rules of engagement (master prompt Security Priority 0).
 * No scan runs without a valid manifest. Authorization-first, fail-closed.
 */
import { z } from "zod";

export const ScopeManifest = z.object({
  manifest_id: z.string().min(4).max(80),
  authorizer: z.string().min(2).max(120),
  environment: z.enum(["local", "staging", "production", "third-party", "unknown"]),
  targets: z
    .array(
      z.object({
        kind: z.enum(["local_path", "fixture", "url"]),
        value: z.string().min(1).max(500),
      })
    )
    .min(1)
    .max(20),
  exclusions: z.array(z.string().max(300)).max(20).default([]),
  allowed_actions: z
    .array(z.enum(["passive_scan", "active_scan", "exploit_validation"]))
    .min(1),
  forbidden_actions: z
    .array(z.string().min(3).max(120))
    .default([
      "destructive payloads",
      "persistence",
      "credential harvesting",
      "denial of service",
      "data exfiltration",
    ]),
  rate_limit_rps: z.number().int().positive().max(50).default(5),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
});
export type ScopeManifest = z.infer<typeof ScopeManifest>;

/** The only local targets MVP scanning may ever touch. */
export const LOCAL_ALLOWLIST = [
  "security-fixtures/vulnerable-app",
  "vulnerable-app",
  "workspace-diff",
];

export interface ManifestCheck {
  ok: boolean;
  reasons: string[];
}

export function validateManifest(m: ScopeManifest, now = new Date()): ManifestCheck {
  const reasons: string[] = [];

  const parsed = ScopeManifest.safeParse(m);
  if (!parsed.success) {
    return { ok: false, reasons: ["manifest schema invalid", ...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`)] };
  }

  if (m.environment !== "local") {
    reasons.push(`environment ${m.environment} is not permitted in MVP (local only)`);
  }
  const start = new Date(m.starts_at);
  const end = new Date(m.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    reasons.push("invalid time window");
  } else {
    if (now < start) reasons.push("authorization window has not started");
    if (now > end) reasons.push("authorization window expired");
    if (end.getTime() - start.getTime() > 24 * 3600 * 1000) {
      reasons.push("window exceeds 24h maximum for local mode");
    }
  }
  for (const t of m.targets) {
    if (t.kind === "url") reasons.push(`url targets are dormant in MVP: ${t.value}`);
    if (t.kind === "local_path" && !LOCAL_ALLOWLIST.some((a) => t.value.includes(a))) {
      reasons.push(`local target not on allowlist: ${t.value}`);
    }
  }
  if (m.allowed_actions.includes("exploit_validation")) {
    reasons.push("exploit_validation requires security-owner approval outside MVP");
  }
  return { ok: reasons.length === 0, reasons };
}
