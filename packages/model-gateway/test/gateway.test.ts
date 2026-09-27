import { describe, it, expect } from "vitest";
import { createModelGateway, MockModelAdapter } from "../src/index.js";

describe("gateway factory", () => {
  it("falls back to mock without an API key", () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const gw = createModelGateway();
      expect(gw.primary.route).toBe("mock/deterministic-v1");
      expect(gw.fallback.route).toBe("mock/deterministic-v1");
    } finally {
      if (key) process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe("mock adapter", () => {
  it("is deterministic and receipted", async () => {
    const a = new MockModelAdapter();
    const req = {
      purpose: "planning" as const,
      system: "sys",
      user: "user prompt",
      max_tokens: 100,
    };
    const r1 = await a.complete(req);
    const r2 = await a.complete(req);
    expect(r1.text).toBe(r2.text);
    expect(r1.receipt.ok).toBe(true);
    expect(r1.receipt.provider).toBe("mock");
    expect(r1.receipt.input_chars).toBeGreaterThan(0);
  });
});
