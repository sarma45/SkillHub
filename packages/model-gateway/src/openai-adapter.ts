/**
 * OpenAI adapters — real provider implementations (no SDK; fetch only),
 * mirroring the Anthropic adapters' contracts exactly so the router can
 * swap providers without touching the loop or planner.
 */
import type {
  ModelGatewayPort,
  ModelRequest,
  ModelCallReceipt,
  ToolUsePort,
  ToolUseTurnRequest,
  ToolUseTurnResult,
} from "./port.js";
import { ProviderUnavailableError } from "./port.js";

const API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

function receipt(purpose: string, started: number, inChars: number, outChars: number, ok: boolean, errorCode: string | null): ModelCallReceipt {
  return {
    provider: "openai",
    model: MODEL,
    latency_ms: Date.now() - started,
    input_chars: inChars,
    output_chars: outChars,
    ok,
    error_code: errorCode,
  };
}

export class OpenAIAdapter implements ModelGatewayPort {
  readonly route = `openai/${MODEL}`;
  constructor(private readonly apiKey: string) {}
  static fromEnv(): OpenAIAdapter | null {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAIAdapter(key) : null;
  }
  async complete(req: ModelRequest): Promise<{ text: string; receipt: ModelCallReceipt }> {
    const started = Date.now();
    const inChars = req.system.length + req.user.length;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: req.max_tokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new ProviderUnavailableError("openai", `HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content ?? "";
      return { text, receipt: receipt("complete", started, inChars, text.length, true, null) };
    } catch (err) {
      throw Object.assign(new ProviderUnavailableError("openai", err instanceof Error ? err.message : err), {
        receipt: receipt("complete", started, inChars, 0, false, "PROVIDER_UNAVAILABLE"),
      });
    }
  }
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export class OpenAIToolAdapter implements ToolUsePort {
  readonly route = `openai/${MODEL}+tools`;
  constructor(private readonly apiKey: string) {}
  static fromEnv(): OpenAIToolAdapter | null {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAIToolAdapter(key) : null;
  }

  async nextTurn(turn: ToolUseTurnRequest): Promise<ToolUseTurnResult> {
    const started = Date.now();
    const inChars = turn.system.length + turn.messages.reduce((n, m) => n + m.content.length, 0);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: turn.max_tokens,
          messages: [
            { role: "system", content: turn.system },
            ...turn.messages.map(toOpenAiMessage),
          ],
          tools: turn.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new ProviderUnavailableError("openai", `HTTP ${res.status}`);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }>;
      };
      const msg = body.choices?.[0]?.message ?? {};
      const call = msg.tool_calls?.[0];
      if (call?.function?.name) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          input = {};
        }
        return {
          kind: "tool_call",
          tool_use_id: call.id ?? `openai_${Date.now()}`,
          tool_name: call.function.name,
          input,
          receipt: receipt("tool_turn", started, inChars, JSON.stringify(input).length, true, null),
        };
      }
      const text = msg.content ?? "";
      return { kind: "text", text, receipt: receipt("tool_turn", started, inChars, text.length, true, null) };
    } catch (err) {
      throw Object.assign(new ProviderUnavailableError("openai", err instanceof Error ? err.message : err), {
        receipt: receipt("tool_turn", started, inChars, 0, false, "PROVIDER_UNAVAILABLE"),
      });
    }
  }
}

function toOpenAiMessage(m: ToolUseTurnRequest["messages"][number]): Record<string, unknown> {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.content };
    case "assistant_text":
      return { role: "assistant", content: m.content };
    case "tool_result":
      return {
        role: "tool",
        tool_call_id: m.tool_use_id,
        content: m.content,
      };
  }
}
