/**
 * Provider catalog (Phase 5 routing — weave-router/OmniRoute/freellmapi
 * patterns): a signed-ish versioned catalog of model providers with
 * capability, cost, latency, and privacy metadata. Routing is deterministic
 * policy over this catalog; the LLM never routes itself.
 */
import type { ModelGatewayPort, ToolUsePort } from "@cockpit/model-gateway";

export interface ProviderEntry {
  id: string;
  label: string;
  /** model adapter key used by the model-gateway factory */
  adapter: "anthropic" | "openai" | "mock" | "scripted";
  /** tool-use adapter key; null = provider cannot drive the autonomous loop */
  tools_adapter: "anthropic_tools" | "openai_tools" | "scripted" | null;
  /** env var holding the key; null = no key needed */
  key_env: string | null;
  /** what the provider is good for */
  strengths: Array<"planning" | "editing" | "tools" | "fast" | "cheap" | "long_context">;
  /** relative cost per task, 1 (cheap) .. 10 (expensive) */
  cost: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  /** expected latency class */
  latency: "fast" | "standard" | "slow";
  /** privacy class per master prompt §2.6 */
  privacy: "local" | "cloud_us" | "cloud_eu";
  /** rough context window tier */
  context_tier: "small" | "large";
  enabled: boolean;
  notes: string;
}

/** The versioned catalog. Adding a provider = adding an entry + adapter. */
export const PROVIDER_CATALOG: readonly ProviderEntry[] = [
  {
    id: "anthropic-claude-sonnet-4",
    label: "Anthropic Claude Sonnet 4",
    adapter: "anthropic",
    tools_adapter: "anthropic_tools",
    key_env: "ANTHROPIC_API_KEY",
    strengths: ["planning", "editing", "tools", "long_context"],
    cost: 5,
    latency: "standard",
    privacy: "cloud_us",
    context_tier: "large",
    enabled: true,
    notes: "Primary generative + tool-use provider when a key is configured.",
  },
  {
    id: "openai-gpt-4o",
    label: "OpenAI GPT-4o",
    adapter: "openai",
    tools_adapter: "openai_tools",
    key_env: "OPENAI_API_KEY",
    strengths: ["planning", "editing", "tools", "fast"],
    cost: 4,
    latency: "fast",
    privacy: "cloud_us",
    context_tier: "large",
    enabled: true,
    notes: "Fallback generative + tool-use provider.",
  },
  {
    id: "mock-deterministic-v1",
    label: "Deterministic mock (offline)",
    adapter: "mock",
    tools_adapter: null,
    key_env: null,
    strengths: ["planning", "editing", "fast", "cheap"],
    cost: 1,
    latency: "fast",
    privacy: "local",
    context_tier: "small",
    enabled: true,
    notes: "Zero-key deterministic executor; always allowed as fallback.",
  },
  {
    id: "scripted-tool-use-v1",
    label: "Scripted tool-use (offline autonomy)",
    adapter: "scripted",
    tools_adapter: "scripted",
    key_env: null,
    strengths: ["tools", "fast", "cheap"],
    cost: 1,
    latency: "fast",
    privacy: "local",
    context_tier: "small",
    enabled: true,
    notes: "Deterministic autonomous loop for offline demos/tests.",
  },
];

export interface RouteDecision {
  provider_id: string;
  adapter: ProviderEntry["adapter"];
  tools_adapter: ProviderEntry["tools_adapter"];
  reason: string;
  candidates_considered: string[];
  policy_version: string;
}

export type Purpose = "planning" | "editing" | "tools" | "verification_analysis";

/**
 * Deterministic routing policy (TRD: thresholds in policy, not prompts).
 * Priority: configured keys first, then purpose-fit, then cost, then latency.
 */
export const ROUTING_POLICY_VERSION = "1.1.0";

export function routeProvider(purpose: Purpose, env: NodeJS.ProcessEnv = process.env): RouteDecision {
  const available = PROVIDER_CATALOG.filter(
    (p) => p.enabled && (p.key_env === null || !!env[p.key_env])
  );
  const candidates = available.map((p) => p.id);

  // hard requirement: tool-use purposes need a tool-capable adapter
  const toolCapable = available.filter((p) =>
    purpose === "tools" ? p.tools_adapter !== null : true
  );

  // purpose-fit scoring: key-backed providers first (offline = fallback),
  // then strengths overlap, then cost, then latency/privacy.
  const purposeKey: Purpose = purpose === "verification_analysis" ? "planning" : purpose;
  const scored = toolCapable
    .map((p) => {
      let score = 0;
      if (p.key_env !== null) score += 8; // a configured real provider beats offline fallbacks
      if (p.strengths.includes(purposeKey)) score += 4;
      if (purpose === "tools" && p.tools_adapter !== null) score += 3;
      score += Math.max(0, 6 - p.cost); // cheap wins ties
      if (p.latency === "fast") score += 1;
      if (p.privacy === "local") score += 1; // prefer local when equal
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  const winner = scored[0] ?? { p: PROVIDER_CATALOG.find((x) => x.adapter === "mock")!, score: 0 };
  const reasons: string[] = [];
  if (winner.p.strengths.includes(purposeKey)) reasons.push(`fits ${purpose}`);
  if (winner.p.key_env === null) reasons.push("no key required");
  else reasons.push(`key ${winner.p.key_env} present`);
  reasons.push(`cost ${winner.p.cost}/10`, `latency ${winner.p.latency}`);

  return {
    provider_id: winner.p.id,
    adapter: winner.p.adapter,
    tools_adapter: winner.p.tools_adapter,
    reason: reasons.join("; "),
    candidates_considered: candidates,
    policy_version: ROUTING_POLICY_VERSION,
  };
}

export function listProviders(env: NodeJS.ProcessEnv = process.env): Array<ProviderEntry & { key_present: boolean }> {
  return PROVIDER_CATALOG.map((p) => ({ ...p, key_present: p.key_env === null || !!env[p.key_env] }));
}
