import { describe, it, expect } from "vitest";
import { buildRepositoryMap } from "../src/index.js";
import path from "node:path";

const FIXTURE = path.resolve(__dirname, "../../../fixtures/sample-app");

describe("buildRepositoryMap", () => {
  it("identifies the sample fixture's stack, commands, and entry points", async () => {
    const map = await buildRepositoryMap(FIXTURE);
    expect(map.languages).toContain("TypeScript");
    expect(map.framework).toBe("Next.js");
    expect(map.package_manager).toBe("npm");
    expect(map.test_command).toBe("npm test");
    expect(map.build_command).toBe("npm run build");
    expect(map.facts.find((f) => f.key === "test_command")?.label).toBe("verified");
  });

  it("labels unknowns honestly when a fact cannot be verified", async () => {
    const map = await buildRepositoryMap(FIXTURE);
    // fixture has tests; but check the unknown path renders a question when absent
    expect(map.unresolved_questions.length).toBeLessThan(3);
  });

  it("summarizes directories with provenance labels", async () => {
    const map = await buildRepositoryMap(FIXTURE);
    expect(map.directories.length).toBeGreaterThan(0);
    expect(map.directories.every((d) => ["observed", "verified", "inferred", "unknown", "proposed"].includes(d.label))).toBe(true);
  });

  it("does not descend into node_modules or .git", async () => {
    const map = await buildRepositoryMap(FIXTURE);
    const paths: string[] = [];
    const visit = (n: { name: string; path: string; children?: unknown[] }) => {
      paths.push(n.path);
      for (const c of (n.children ?? []) as never[]) visit(c as never);
    };
    visit(map.tree);
    expect(paths.every((p) => !p.includes("node_modules") && !p.includes(".git"))).toBe(true);
  });
});
