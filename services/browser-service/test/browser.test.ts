import { describe, it, expect } from "vitest";
import { assertLoopbackUrl, findBrowserBinary } from "../src/index.js";

describe("browser service (real, CDP-driven)", () => {
  it("refuses non-loopback URLs (security boundary)", () => {
    expect(() => assertLoopbackUrl("https://evil.example.com/x")).toThrow(/loopback/);
    expect(() => assertLoopbackUrl("file:///etc/passwd")).toThrow(/loopback/);
    expect(() => assertLoopbackUrl("ftp://localhost")).toThrow(/loopback/);
  });

  it("allows loopback http(s) URLs", () => {
    expect(assertLoopbackUrl("http://localhost:3000/app").toString()).toContain("localhost:3000");
    expect(assertLoopbackUrl("http://127.0.0.1:3000/health").protocol).toBe("http:");
  });

  it("finds a real local browser binary (Edge or Chrome)", () => {
    const bin = findBrowserBinary();
    expect(bin).toBeTruthy();
    expect(bin!.toLowerCase()).toMatch(/msedge\.exe|chrome\.exe|chromium|chrome$/);
  });
});
