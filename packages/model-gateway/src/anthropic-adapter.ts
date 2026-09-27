/**
 * AnthropicAdapter — optional real provider. Never imports an SDK; uses fetch
 * so the dependency surface stays minimal and mock-first remains default.
 * Data boundaries: only bounded, purpose-scoped prompts leave the process;
 * no secrets, no raw repository dumps (master prompt §2.6).
 */
import type { ModelGatewayPort, ModelRequest, ModelCallReceipt } from "./port.js";
import { ProviderUnavailableError } from "./port.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

export class AnthropicAdapter implements ModelGatewayPort {
  readonly route: string;

  constructor(private readonly apiKey: string) {
    this.route = `anthropic/${MODEL}`;
  }

  static fromEnv(): AnthropicAdapter | null {
    const key = process.env.ANTHROPIC_API_KEY;
    return key ? new AnthropicAdapter(key) : null;
  }

  async complete(req: ModelRequest): Promise<{ text: string; receipt: ModelCallReceipt }> {
    const started = Date.now();
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
          max_tokens: req.max_tokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new ProviderUnavailableError("anthropic", `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { content?: Array<{ text?: string }> };
      const text = body.content?.map((c) => c.text ?? "").join("") ?? "";
      const receipt: ModelCallReceipt = {
        provider: "anthropic",
        model: MODEL,
        latency_ms: Date.now() - started,
        input_chars: req.system.length + req.user.length,
        output_chars: text.length,
        ok: true,
        error_code: null,
      };
      return { text, receipt };
    } catch (err) {
      const receipt: ModelCallReceipt = {
        provider: "anthropic",
        model: MODEL,
        latency_ms: Date.now() - started,
        input_chars: req.system.length + req.user.length,
        output_chars: 0,
        ok: false,
        error_code: "PROVIDER_UNAVAILABLE",
      };
      throw Object.assign(
        new ProviderUnavailableError("anthropic", err instanceof Error ? err.message : err),
        { receipt }
      );
    }
  }
}
