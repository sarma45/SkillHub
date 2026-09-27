export * from "./port.js";
export * from "./mock-adapter.js";
export * from "./anthropic-adapter.js";
export * from "./anthropic-tool-adapter.js";
export * from "./openai-adapter.js";
export * from "./scripted-tool-adapter.js";

import type { ModelGatewayPort, ToolUsePort } from "./port.js";
import { MockModelAdapter } from "./mock-adapter.js";
import { AnthropicAdapter } from "./anthropic-adapter.js";
import { AnthropicToolAdapter } from "./anthropic-tool-adapter.js";
import { OpenAIAdapter, OpenAIToolAdapter } from "./openai-adapter.js";

/**
 * One primary + one fallback (master prompt MVP scope). Primary is Anthropic
 * when ANTHROPIC_API_KEY exists; the deterministic mock is always allowed as
 * fallback so the product never hard-fails for the human in the loop.
 */
export function createModelGateway(): { primary: ModelGatewayPort; fallback: ModelGatewayPort } {
  const anthropic = AnthropicAdapter.fromEnv();
  if (anthropic) return { primary: anthropic, fallback: new MockModelAdapter() };
  return { primary: new MockModelAdapter(), fallback: new MockModelAdapter() };
}

/** Real tool-use loop provider; null when no provider key is configured. */
export function createToolUseGateway(): ToolUsePort | null {
  return AnthropicToolAdapter.fromEnv() ?? OpenAIToolAdapter.fromEnv();
}

/**
 * Adapter factory by catalog adapter key (routing-service calls this).
 * Returns null when the provider's key is missing or the adapter is unknown.
 */
export function createModelAdapterByKey(adapter: string): ModelGatewayPort | null {
  switch (adapter) {
    case "anthropic":
      return AnthropicAdapter.fromEnv();
    case "openai":
      return OpenAIAdapter.fromEnv();
    case "mock":
      return new MockModelAdapter();
    default:
      return null;
  }
}

/** Same factory for tool-use-capable adapters. */
export function createToolUseAdapterByKey(adapter: string): ToolUsePort | null {
  switch (adapter) {
    case "anthropic_tools":
      return AnthropicToolAdapter.fromEnv();
    case "openai_tools":
      return OpenAIToolAdapter.fromEnv();
    case "scripted":
      return new (class implements ToolUsePort {
        readonly route = "scripted/empty";
        async nextTurn() {
          return { kind: "text" as const, text: "scripted adapter requires a script", receipt: {
            provider: "scripted", model: "empty", latency_ms: 0, input_chars: 0, output_chars: 0, ok: true, error_code: null,
          } };
        }
      })();
    default:
      return null;
  }
}
