/**
 * AnthropicToolAdapter — REAL model-driven autonomy via the Anthropic Messages
 * API native tool-use protocol. Activated only when ANTHROPIC_API_KEY is set.
 * Never imports an SDK (fetch only). Every turn records a receipt.
 */
import type { ToolUsePort, ToolUseTurnRequest, ToolUseTurnResult, ModelCallReceipt } from "./port.js";
import { ProviderUnavailableError } from "./port.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export class AnthropicToolAdapter implements ToolUsePort {
  readonly route = `anthropic/${MODEL}+tools`;

  constructor(private readonly apiKey: string) {}

  static fromEnv(): AnthropicToolAdapter | null {
    const key = process.env.ANTHROPIC_API_KEY;
    return key ? new AnthropicToolAdapter(key) : null;
  }

  async nextTurn(turn: ToolUseTurnRequest): Promise<ToolUseTurnResult> {
    const started = Date.now();
    const receiptBase = (): ModelCallReceipt => ({
      provider: "anthropic",
      model: MODEL,
      latency_ms: Date.now() - started,
      input_chars: turn.system.length + turn.messages.reduce((n, m) => n + m.content.length, 0),
      output_chars: 0,
      ok: false,
      error_code: null,
    });

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: turn.max_tokens,
          system: turn.system,
          tools: turn.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
          messages: turn.messages.map(toAnthropicMessage),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new ProviderUnavailableError("anthropic", `HTTP ${res.status}`);
      const body = (await res.json()) as { content?: AnthropicContentBlock[]; stop_reason?: string };
      const blocks = body.content ?? [];

      const toolBlock = blocks.find((b) => b.type === "tool_use");
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();

      if (toolBlock && toolBlock.id && toolBlock.name) {
        const receipt = receiptBase();
        receipt.ok = true;
        receipt.output_chars = JSON.stringify(toolBlock.input ?? {}).length;
        return {
          kind: "tool_call",
          tool_use_id: toolBlock.id,
          tool_name: toolBlock.name,
          input: (toolBlock.input ?? {}) as Record<string, unknown>,
          receipt,
        };
      }

      const receipt = receiptBase();
      receipt.ok = true;
      receipt.output_chars = text.length;
      return { kind: "text", text, receipt };
    } catch (err) {
      const receipt = receiptBase();
      receipt.error_code = "PROVIDER_UNAVAILABLE";
      throw Object.assign(
        new ProviderUnavailableError("anthropic", err instanceof Error ? err.message : err),
        { receipt }
      );
    }
  }
}

function toAnthropicMessage(m: ToolUseTurnRequest["messages"][number]): Record<string, unknown> {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.content };
    case "assistant_text":
      return { role: "assistant", content: m.content };
    case "tool_result":
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_use_id,
            content: m.content,
            is_error: m.is_error,
          },
        ],
      };
  }
}
