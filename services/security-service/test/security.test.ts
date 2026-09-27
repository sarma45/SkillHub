import { describe, it, expect } from "vitest";
import {
  validateManifest,
  ScopeManifest,
  runBaselineScan,
  runStrixScan,
  ScanRefused,
  fixturePath,
  vulnerableAppPath,
} from "../src/index.js";
import { existsSync } from "node:fs";

function localManifest(overrides: Partial<ScopeManifest> = {}): ScopeManifest {
  const now = new Date();
  return {
    manifest_id: "man_test_001",
    authorizer: "local-owner",
    environment: "local",
    targets: [{ kind: "local_path", value: "security-fixtures/vulnerable-app" }],
    exclusions: [],
    allowed_actions: ["passive_scan"],
    forbidden_actions: ["destructive payloads"],
    rate_limit_rps: 5,
    starts_at: new Date(now.getTime() - 60_000).toISOString(),
    ends_at: new Date(now.getTime() + 3_600_000).toISOString(),
    ...overrides,
  };
}

describe("scope manifest gate", () => {
  it("accepts a valid local manifest", () => {
    expect(validateManifest(localManifest()).ok).toBe(true);
  });

  it("rejects non-local environments (fail closed)", () => {
    const check = validateManifest(localManifest({ environment: "production" }));
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toContain("local only");
  });

  it("rejects expired windows", () => {
    const past = localManifest({
      starts_at: new Date(Date.now() - 7200_000).toISOString(),
      ends_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(validateManifest(past).ok).toBe(false);
  });

  it("rejects url targets in MVP", () => {
    const m = localManifest({ targets: [{ kind: "url", value: "https://example.com" }] });
    expect(validateManifest(m).ok).toBe(false);
  });

  it("rejects targets outside the local allowlist", () => {
    const m = localManifest({ targets: [{ kind: "local_path", value: "C:/Windows" }] });
    expect(validateManifest(m).ok).toBe(false);
  });

  it("rejects exploit validation without security-owner approval", () => {
    const m = localManifest({ allowed_actions: ["passive_scan", "exploit_validation"] });
    expect(validateManifest(m).ok).toBe(false);
  });
});

describe("baseline scanner", () => {
  it("finds the seeded vulnerabilities in the vulnerable-app fixture", async () => {
    const result = await runBaselineScan(localManifest());
    expect(result.scanner).toBe("baseline");
    const titles = result.findings.map((f) => f.title);
    expect(titles).toContain("Hardcoded credential map (user/password pairs)");
    expect(titles).toContain("Unescaped user input rendered into HTML (reflected XSS)");
    expect(result.findings.every((f) => f.evidence.includes("[REDACTED]") || f.evidence.length < 200)).toBe(true);
  });

  it("refuses to scan without a valid manifest", async () => {
    await expect(runBaselineScan(localManifest({ environment: "staging" }))).rejects.toThrow(ScanRefused);
  });

  it("maps findings to OWASP refs", async () => {
    const result = await runBaselineScan(localManifest());
    expect(result.findings.some((f) => f.standard_refs.some((r) => r.includes("OWASP")))).toBe(true);
  });
});

describe("strix adapter", () => {
  it("returns an honest empty result when the strix binary is absent", async () => {
    const result = await runStrixScan(localManifest());
    expect(result.scanner).toBe("strix");
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("refuses unauthorized targets before touching the scanner", async () => {
    await expect(
      runStrixScan(localManifest({ targets: [{ kind: "url", value: "https://example.com" }] }))
    ).rejects.toThrow(ScanRefused);
  });
});

describe("fixtures", () => {
  it("vulnerable-app fixture exists on disk", () => {
    expect(existsSync(vulnerableAppPath())).toBe(true);
  });

  it("fixture paths resolve inside the repository", () => {
    expect(fixturePath("sample-app")).toContain("fixtures");
  });
});
