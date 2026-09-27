import { describe, it, expect } from "vitest";
import { SKILL_CATALOG, catalogByCategory, coreSkillIds, runtimeSkills, phaseBindings } from "../src/index.js";

describe("skill catalog", () => {
  it("contains at least 50 entries (the user's starred repos + 3 core)", () => {
    expect(SKILL_CATALOG.length).toBeGreaterThanOrEqual(53);
  });

  it("contains exactly the 50 starred repos", () => {
    const urls = SKILL_CATALOG.map((e) => e.manifest.source_url).filter(Boolean);
    const expected = [
      "https://github.com/Z4nzu/hackingtool",
      "https://github.com/borghei/Claude-Skills",
      "https://github.com/blencorp/claude-code-kit",
      "https://github.com/AccessLint/skills",
      "https://github.com/Jeffallan/claude-skills",
      "https://github.com/wondelai/skills",
      "https://github.com/CloudAI-X/threejs-skills",
      "https://github.com/kylezantos/design-motion-principles",
      "https://github.com/freshtechbro/claudedesignskills",
      "https://github.com/bergside/typeui",
      "https://github.com/bencium/bencium-marketplace",
      "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
      "https://github.com/mattpocock/skills",
      "https://github.com/ibelick/ui-skills",
      "https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit",
      "https://github.com/openai/skills",
      "https://github.com/bradtraversy/design-resources-for-developers",
      "https://github.com/ComposioHQ/awesome-claude-skills",
      "https://github.com/VoltAgent/awesome-agent-skills",
      "https://github.com/JasonColapietro/suede-creator-skills",
      "https://github.com/vercel-labs/agent-skills",
      "https://github.com/nexu-io/open-design",
      "https://github.com/google-labs-code/design.md",
      "https://github.com/superdesigndev/superdesign-skill",
      "https://github.com/Jakubantalik/transitions.dev",
      "https://github.com/Leonxlnx/taste-skill",
      "https://github.com/addyosmani/agent-skills",
      "https://github.com/anthropics/skills",
      "https://github.com/Anil-matcha/Open-Generative-AI",
      "https://github.com/browser-use/browser-use",
      "https://github.com/volcengine/OpenViking",
      "https://github.com/ai-boost/awesome-harness-engineering",
      "https://github.com/cathrynlavery/diagram-design",
      "https://github.com/K-Dense-AI/scientific-agent-skills",
      "https://github.com/rohitg00/agentmemory",
      "https://github.com/usestrix/strix",
      "https://github.com/MadsLorentzen/ai-job-search",
      "https://github.com/virgiliojr94/book-to-skill",
      "https://github.com/every-app/open-seo",
      "https://github.com/ayghri/i-have-adhd",
      "https://github.com/petergyang/no-ai-slop",
      "https://github.com/lfnovo/open-notebook",
      "https://github.com/tashfeenahmed/freellmapi",
      "https://github.com/weave-os/router",
      "https://github.com/CodebuffAI/freebuff",
      "https://github.com/diegosouzapw/OmniRoute",
      "https://github.com/ruvnet/ruflo",
      "https://github.com/anthropics/claude-cookbooks",
      "https://github.com/sarma45/Aiverse_2.0",
      "https://github.com/sarma45/Nextjsportfolio",
    ].sort();
    expect([...urls].sort()).toEqual(expected);
  });

  it("marks offensive toolkits catalog-only with forbidden runtime activation", () => {
    const ht = SKILL_CATALOG.find((e) => e.manifest.id === "hackingtool")!;
    expect(ht.manifest.status).toBe("catalog_only");
    expect(ht.manifest.forbidden_actions).toContain("runtime activation");
  });

  it("keeps design sources reviewed and bound to phase 7", () => {
    const design = (catalogByCategory()["design"] ?? []).filter((e) => e.manifest.status === "reviewed");
    expect(design.length).toBeGreaterThanOrEqual(8);
    for (const d of design) expect(d.manifest.phase).toBe(7);
  });

  it("approves exactly the 7 first-party skills (3 MVP + 4 Phase 4+ features)", () => {
    expect(coreSkillIds().sort()).toEqual([
      "autonomous-execution",
      "browser-verification",
      "context-assembly",
      "plan-generation",
      "project-memory",
      "repo-exploration",
      "safe-code-edit",
    ]);
  });

  it("runtime binding exposes only approved skills", () => {
    const rt = runtimeSkills();
    expect(rt.every((e) => e.manifest.status === "approved")).toBe(true);
    expect(rt.length).toBe(7);
  });

  it("every entry has valid github provenance or is first-party", () => {
    for (const e of SKILL_CATALOG) {
      if (e.manifest.source_repo === null) {
        expect(e.manifest.status).toBe("approved"); // first-party
      } else {
        expect(e.manifest.source_url).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
      }
    }
  });

  it("builds phase bindings for the §6B table", () => {
    const bindings = phaseBindings();
    expect(bindings.length).toBeGreaterThanOrEqual(7);
    const p7 = bindings.find((b) => b.phase === 7);
    expect(p7?.repos).toContain("google-labs-code/design.md");
  });
});
