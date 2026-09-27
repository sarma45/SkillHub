/**
 * Skill catalog — the user's 50 starred repositories, bound to product phases
 * per master prompt §6B. Each entry: provenance (repo URL, license where
 * known), category, phase mapping, and registry status.
 *
 * Statuses:
 *  - approved    : first-party MVP skills (no external source)
 *  - reviewed    : pattern-source studied and distilled into the product (design system)
 *  - candidate   : planned integration target (runtime adapter behind a dormant flag)
 *  - catalog_only: reference entry; never wired into runtime (e.g., offensive toolkits)
 */
import type { SkillManifest } from "@cockpit/contracts";

export interface CatalogEntry {
  manifest: SkillManifest;
}

const repo = (owner: string, name: string) => `https://github.com/${owner}/${name}`;

function entry(
  id: string,
  name: string,
  purpose: string,
  category: SkillManifest["category"],
  phase: number | null,
  status: SkillManifest["status"],
  owner: string,
  repoName: string,
  license: string | null,
  triggers: string[] = [],
  risk: SkillManifest["risk_level"] = "low"
): CatalogEntry {
  return {
    manifest: {
      id,
      version: "0.1.0",
      name,
      purpose,
      source_repo: `${owner}/${repoName}`,
      source_url: repo(owner, repoName),
      source_commit: null, // pinned per-environment after MVP (capabilities gate it)
      license,
      category,
      phase,
      triggers,
      inputs: ["task context", "repository map reference"],
      outputs: ["skill run receipt"],
      allowed_tools: [],
      forbidden_actions:
        status === "catalog_only"
          ? ["runtime activation", "tool registration", "agent instruction injection"]
          : [],
      risk_level: risk,
      human_checkpoints:
        status === "catalog_only" ? ["activation prohibited in MVP"] : ["before first activation"],
      stop_conditions: ["scope exceeded", "license conflict", "provenance unverifiable"],
      evaluation_fixtures: [],
      status,
    },
  };
}

export const SKILL_CATALOG: CatalogEntry[] = [
  // ---------- first-party MVP skills (approved) ----------
  {
    manifest: {
      id: "repo-exploration",
      version: "1.0.0",
      name: "Repository exploration",
      purpose: "Build a repository map and identify relevant files without editing anything.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "harness",
      phase: 1,
      triggers: ["project import", "map refresh requested"],
      inputs: ["repository root (read-only)"],
      outputs: ["repository map", "directory summaries", "confidence-labeled facts"],
      allowed_tools: ["read_file", "search", "list_tree"],
      forbidden_actions: ["write_workspace", "external_submit"],
      risk_level: "low",
      human_checkpoints: ["map acceptance"],
      stop_conditions: ["index budget exceeded", "unreadable repository"],
      evaluation_fixtures: ["fixtures/sample-app"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "plan-generation",
      version: "1.0.0",
      name: "Plan generation",
      purpose: "Produce an editable, dependency-aware plan with verification steps and checkpoints.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "harness",
      phase: 2,
      triggers: ["task framed"],
      inputs: ["task brief", "repository map"],
      outputs: ["versioned plan document", "plan hash"],
      allowed_tools: ["read_file", "search"],
      forbidden_actions: ["write_workspace", "external_submit"],
      risk_level: "low",
      human_checkpoints: ["plan approval"],
      stop_conditions: ["brief underspecified beyond two clarification rounds"],
      evaluation_fixtures: ["docs/mvp/fixtures.md"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "safe-code-edit",
      version: "1.0.0",
      name: "Safe code edit",
      purpose: "Apply approved plan changes in an isolated workspace, run checks, and produce a diff.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "harness",
      phase: 3,
      triggers: ["plan approved"],
      inputs: ["approved plan (hash-bound)", "isolated workspace"],
      outputs: ["workspace diff", "tool receipts", "evidence records"],
      allowed_tools: ["read_file", "search", "list_tree", "edit_file", "run_tests", "compute_diff"],
      forbidden_actions: ["external_submit", "editing outside plan.affected_files"],
      risk_level: "medium",
      human_checkpoints: ["review before integration"],
      stop_conditions: ["budget exhausted", "out-of-scope file edit requested"],
      evaluation_fixtures: ["fixtures/sample-app"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "autonomous-execution",
      version: "1.0.0",
      name: "Autonomous execution loop",
      purpose: "Execute an approved plan with a model-driven tool-use loop behind deterministic policy gates.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "harness",
      phase: 4,
      triggers: ["run started in autonomous mode"],
      inputs: ["approved plan (hash-bound)", "isolated workspace", "context bundle"],
      outputs: ["workspace diff", "tool receipts", "final model summary", "lesson memories"],
      allowed_tools: ["read_file", "search", "list_tree", "edit_file", "run_tests", "compute_diff", "remember", "browser_verify"],
      forbidden_actions: ["external_submit", "editing outside plan.affected_files", "bypassing scope checks"],
      risk_level: "medium",
      human_checkpoints: ["plan approval before any run", "review before integration"],
      stop_conditions: ["final summary", "budgets exhausted", "deadline", "cancellation", "post-loop tests fail"],
      evaluation_fixtures: ["fixtures/sample-app"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "project-memory",
      version: "1.0.0",
      name: "Project memory",
      purpose: "Save durable lessons and facts with scope, sensitivity, and a human approval checkpoint before influence.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "memory-context",
      phase: 4,
      triggers: ["run completes", "agent saves a lesson", "user saves a preference"],
      inputs: ["memory content", "scope", "kind", "sensitivity"],
      outputs: ["memory row", "approval state"],
      allowed_tools: ["remember"],
      forbidden_actions: ["writing restricted memories without consent", "storing secrets"],
      risk_level: "low",
      human_checkpoints: ["approval of agent-written memories"],
      stop_conditions: ["content rejected by redaction", "missing sensitivity label"],
      evaluation_fixtures: ["services/memory-service/test/memory.test.ts"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "browser-verification",
      version: "1.0.0",
      name: "Browser verification",
      purpose: "Verify generated UI in a real headless browser (CDP) with screenshots, console, and HTTP evidence.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "quality",
      phase: 6,
      triggers: ["UI change needs visual verification"],
      inputs: ["loopback URL", "optional expected text"],
      outputs: ["PNG screenshot artifact", "console messages", "HTTP failures"],
      allowed_tools: ["browser_verify"],
      forbidden_actions: ["non-loopback navigation", "destructive interactions", "external form submission"],
      risk_level: "medium",
      human_checkpoints: ["review of screenshots before integration"],
      stop_conditions: ["loopback allowlist refusal", "no browser binary", "capture timeout"],
      evaluation_fixtures: ["services/browser-service/test/browser.test.ts"],
      status: "approved",
    },
  },
  {
    manifest: {
      id: "context-assembly",
      version: "1.0.0",
      name: "Context assembly",
      purpose: "Build budgeted, provenance-labeled context bundles (project, map, memory, file layers) for planning and execution.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "memory-context",
      phase: 4,
      triggers: ["plan generation", "run start", "context bundle API"],
      inputs: ["project id", "repository map", "task request"],
      outputs: ["context bundle with inclusion reasons", "truncation report"],
      allowed_tools: ["list_tree", "read_file", "remember"],
      forbidden_actions: ["reading sensitive paths", "silently exceeding the budget"],
      risk_level: "low",
      human_checkpoints: [],
      stop_conditions: ["budget exhausted with reported truncations", "project map missing"],
      evaluation_fixtures: ["fixtures/sample-repo-map.json"],
      status: "approved",
    },
  },

  // ---------- design pattern sources (reviewed — distilled into DESIGN.md + packages/ui) ----------
  entry("design-md", "design.md — intentional design direction", "Structured method for choosing and documenting a design direction before implementation.", "design", 7, "reviewed", "google-labs-code", "design.md", "MIT", ["new surface design", "token definition"]),
  entry("ui-ux-pro-max", "UI/UX Pro Max skill", "Practical UI/UX heuristics for product screens, states, and layout decisions.", "design", 7, "reviewed", "nextlevelbuilder", "ui-ux-pro-max-skill", null, ["screen design review"]),
  entry("superdesign", "Superdesign skill", "Design-system awareness: respect the target project's existing visual language.", "design", 7, "reviewed", "superdesigndev", "superdesign-skill", null, ["introducing components"]),
  entry("typeui", "TypeUI", "Typography-led component thinking: hierarchy, rhythm, and legibility first.", "design", 7, "reviewed", "bergside", "typeui", "MIT", ["typography setup"]),
  entry("taste-skill", "Taste skill", "Motion and taste controls: when animation explains state versus decorates.", "design", 7, "reviewed", "Leonxlnx", "taste-skill", null, ["motion review"]),
  entry("ibelick-ui-skills", "UI skills (ibelick)", "Modern interface component patterns: depth, layering, and interaction detail.", "design", 7, "reviewed", "ibelick", "ui-skills", null, ["component design"]),
  entry("design-motion-principles", "Design motion principles", "Motion principles: easing, duration, and cause-effect clarity.", "design", 7, "reviewed", "kylezantos", "design-motion-principles", null, ["motion spec"]),
  entry("transitions-dev", "transitions.dev", "Transition design references for state changes and navigation.", "design", 7, "reviewed", "Jakubantalik", "transitions.dev", null, ["transition design"]),
  entry("claudedesignskills", "Claude design skills (freshtechbro)", "Frontend design skill collection: layout, color, and component guidance.", "design", 7, "reviewed", "freshtechbro", "claudedesignskills", null, ["design system work"]),
  entry("frontend-design-toolkit", "Claude Code frontend design toolkit", "Toolkit of frontend design prompts and checklists for non-generic UI.", "design", 7, "reviewed", "wilwaldon", "Claude-Code-Frontend-Design-Toolkit", null, ["frontend review"]),
  entry("design-resources", "Design resources for developers", "Curated design resources: fonts, colors, icons, and inspiration sources.", "design", 7, "catalog_only", "bradtraversy", "design-resources-for-developers", null, []),
  entry("diagram-design", "Diagram design", "Design guidance for diagrams: clarity, hierarchy, and annotation discipline.", "design", 7, "candidate", "cathrynlavery", "diagram-design", null, ["architecture diagrams"]),
  entry("threejs-skills", "Three.js skills", "3D/Three.js scene design and performance guidance for web experiences.", "design", 7, "catalog_only", "CloudAI-X", "threejs-skills", null, []),

  // ---------- security (Phase 6/8) ----------
  entry("strix", "Strix — authorized offensive-security validator", "Proof-oriented dynamic security testing behind scope manifests and ROE.", "security", 6, "candidate", "usestrix", "strix", "MIT", ["local safe-lab scan", "diff-scoped PR gate"], "high"),
  entry("hackingtool", "Hackingtool (catalog only)", "Offensive toolkit reference. Catalog-only: never wired into runtime; activation forbidden.", "security", null, "catalog_only", "Z4nzu", "hackingtool", "MIT", [], "critical"),
  entry("accesslint-skills", "AccessLint skills", "Accessibility discipline for agent-generated UI: keyboard, contrast, semantics.", "quality", 6, "reviewed", "AccessLint", "skills", null, ["a11y gate"], "low"),

  // ---------- harness / execution (Phase 3) ----------
  entry("ruflo", "Ruflo harness patterns", "Harness state controls, hooks, and bounded agent execution loops.", "harness", 3, "candidate", "ruvnet", "ruflo", null, ["harness design"], "medium"),
  entry("claude-code-kit", "Claude Code kit", "Tooling patterns for coding-agent workflows and hooks.", "harness", 3, "candidate", "blencorp", "claude-code-kit", null, [], "medium"),
  entry("freebuff", "Codebuff Freebuff", "Multi-agent coding-agent runtime patterns and tool use.", "harness", 3, "candidate", "CodebuffAI", "freebuff", "MIT", [], "medium"),
  entry("browser-use", "browser-use", "Browser automation for visual verification and UI flows (dormant adapter).", "harness", 6, "candidate", "browser-use", "browser-use", "MIT", ["visual verification"], "medium"),
  entry("awesome-harness-engineering", "Awesome harness engineering", "Curated harness-engineering principles: loops, budgets, verification.", "harness", 0, "reviewed", "ai-boost", "awesome-harness-engineering", null, ["harness review"]),

  // ---------- memory / context (Phase 1/4) ----------
  entry("openviking", "OpenViking hierarchical context", "Hierarchical context patterns: org → project → directory → file summaries.", "memory-context", 1, "candidate", "volcengine", "OpenViking", null, ["context assembly"], "medium"),
  entry("agentmemory", "Agent memory patterns", "Memory lifecycle, confidence, and scoping patterns for agents.", "memory-context", 4, "candidate", "rohitg00", "agentmemory", null, [], "medium"),
  entry("book-to-skill", "book-to-skill", "Extract versioned skills from long-form sources with provenance.", "memory-context", 4, "candidate", "virgiliojr94", "book-to-skill", null, [], "medium"),
  entry("open-notebook", "Open Notebook", "Notebook-style knowledge management with citations (dormant memory feature).", "memory-context", 4, "candidate", "lfnovo", "open-notebook", "MIT", [], "medium"),

  // ---------- skill collections (Phase 2/9) ----------
  entry("anthropics-skills", "Anthropics skills", "Canonical Agent Skills format and engineering skill examples.", "content-pattern", 2, "reviewed", "anthropics", "skills", "MIT", ["skill authoring"]),
  entry("mattpocock-skills", "Matt Pocock skills", "TypeScript engineering methods packaged as skills.", "content-pattern", 2, "reviewed", "mattpocock", "skills", null, ["TS planning"]),
  entry("wondelai-skills", "Wondelai skills", "Discovery and planning skill patterns (JTBD).", "content-pattern", 0, "reviewed", "wondelai", "skills", null, ["discovery"]),
  entry("openai-skills", "OpenAI skills", "Skill format references from OpenAI (codex-style workflows).", "content-pattern", 2, "candidate", "openai", "skills", "MIT", []),
  entry("jeffallan-skills", "Jeffallan claude skills", "Community skill collection: engineering workflow patterns.", "content-pattern", 2, "candidate", "Jeffallan", "claude-skills", null, []),
  entry("borghei-skills", "Borghei claude skills", "Community skill collection reference.", "content-pattern", 2, "catalog_only", "borghei", "Claude-Skills", null, []),
  entry("awesome-claude-skills", "Awesome Claude Skills", "Index of community skills; discovery aid for the registry.", "content-pattern", 9, "catalog_only", "ComposioHQ", "awesome-claude-skills", null, []),
  entry("awesome-agent-skills", "VoltAgent awesome agent skills", "Index of agent skills across ecosystems.", "content-pattern", 9, "catalog_only", "VoltAgent", "awesome-agent-skills", null, []),
  entry("vercel-agent-skills", "Vercel Labs agent skills", "Web-quality and a11y-oriented agent skills.", "quality", 6, "reviewed", "vercel-labs", "agent-skills", null, ["web quality gate"]),
  entry("addyosmani-agent-skills", "Addy Osmani agent skills", "Engineering-craft skill collection for evaluation loops.", "content-pattern", 9, "candidate", "addyosmani", "agent-skills", null, []),
  entry("suede-creator-skills", "Suede creator skills", "Design/creation workflow skill collection reference.", "design", 7, "catalog_only", "JasonColapietro", "suede-creator-skills", null, []),
  entry("open-design", "Nexu open design", "Open design system patterns and tokens reference.", "design", 7, "candidate", "nexu-io", "open-design", null, []),
  entry("scientific-agent-skills", "K-Dense scientific agent skills", "Domain (scientific) skill packaging examples.", "content-pattern", 9, "catalog_only", "K-Dense-AI", "scientific-agent-skills", null, []),

  // ---------- quality (Phase 6) ----------
  entry("no-ai-slop", "No AI slop", "Detect and prevent generic AI-generated UI/text patterns.", "quality", 6, "reviewed", "petergyang", "no-ai-slop", null, ["UI quality gate"]),
  entry("open-seo", "Open SEO", "SEO evaluation guidance for web surfaces.", "quality", 6, "candidate", "every-app", "open-seo", null, ["SEO review"]),

  // ---------- routing (Phase 5) ----------
  entry("weave-router", "Weave OS router", "Provider/action routing policy patterns with observability.", "routing", 5, "candidate", "weave-os", "router", null, ["routing policy"], "medium"),
  entry("omniroute", "OmniRoute", "Multi-provider LLM routing and fallback patterns.", "routing", 5, "candidate", "diegosouzapw", "OmniRoute", null, [], "medium"),
  entry("freellmapi", "FreeLLM API", "Unified open LLM API gateway patterns.", "routing", 5, "candidate", "tashfeenahmed", "freellmapi", null, [], "medium"),

  // ---------- integration / references (Phase 8) ----------
  entry("claude-cookbooks", "Anthropic cookbooks", "Model-integration recipes: tool use, evals, document processing.", "integration", 8, "reviewed", "anthropics", "claude-cookbooks", "MIT", ["provider integration"]),
  entry("open-generative-ai", "Open Generative AI", "Reference catalog of generative AI integrations.", "integration", 8, "catalog_only", "Anil-matcha", "Open-Generative-AI", null, []),

  // ---------- content-pattern misc ----------
  entry("ai-job-search", "AI job search", "Personal-career skill pack; unrelated to runtime. Catalog reference.", "content-pattern", null, "catalog_only", "MadsLorentzen", "ai-job-search", null, []),
  entry("i-have-adhd", "I have ADHD", "Personal productivity skill pack; unrelated to runtime. Catalog reference.", "content-pattern", null, "catalog_only", "ayghri", "i-have-adhd", null, []),
  entry("bencium-marketplace", "Bencium marketplace", "Skill marketplace layout reference (dormant marketplace capability).", "content-pattern", 9, "catalog_only", "bencium", "bencium-marketplace", null, []),
  entry("aiverse-2", "Aiverse 2.0", "AI-directory site design reference for marketing surfaces.", "content-pattern", null, "catalog_only", "sarma45", "Aiverse_2.0", null, []),
  entry("nextjs-portfolio", "Next.js portfolio", "Next.js site structure reference for public pages.", "content-pattern", null, "catalog_only", "sarma45", "Nextjsportfolio", null, []),
];

export function catalogByCategory(): Record<string, CatalogEntry[]> {
  const out: Record<string, CatalogEntry[]> = {};
  for (const e of SKILL_CATALOG) {
    (out[e.manifest.category] ??= []).push(e);
  }
  return out;
}

export function coreSkillIds(): string[] {
  return SKILL_CATALOG.filter((e) => e.manifest.status === "approved").map(
    (e) => e.manifest.id
  );
}
