/**
 * MockModelAdapter — deterministic, zero-dependency stand-in for a generative
 * model. Produces stable, fixture-friendly outputs so the whole MVP loop runs
 * without any provider keys (master prompt: "mock-first" chosen build mode).
 */
import type { ModelGatewayPort, ModelRequest, ModelCallReceipt } from "./port.js";

export class MockModelAdapter implements ModelGatewayPort {
  readonly route = "mock/deterministic-v1";

  async complete(req: ModelRequest): Promise<{ text: string; receipt: ModelCallReceipt }> {
    const started = Date.now();
    const text = mockComplete(req);
    const receipt: ModelCallReceipt = {
      provider: "mock",
      model: "deterministic-v1",
      latency_ms: Date.now() - started + 1,
      input_chars: req.system.length + req.user.length,
      output_chars: text.length,
      ok: true,
      error_code: null,
    };
    return { text, receipt };
  }
}

function mockComplete(req: ModelRequest): string {
  switch (req.purpose) {
    case "planning":
      return "__MOCK_PLAN__"; // planning-service interprets this sentinel
    case "editing":
      return `<!-- deterministic edit proposal; harness applies template-based changes -->\n${req.user.slice(0, 200)}`;
    case "verification_analysis":
      return "Observed: automated checks executed. Unknown: semantic correctness requires human review.";
    default:
      return "";
  }
}
