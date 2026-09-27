/**
 * ScriptedToolAdapter — deterministic ToolUsePort for tests and offline runs.
 * Executes a script of turns; when the script is exhausted it returns a final
 * text turn. Not a mock of the product: it is the same protocol the real
 * Anthropic adapter speaks, so the loop code is exercised identically.
 */
import type { ToolUsePort, ToolUseTurnRequest, ToolUseTurnResult, ModelCallReceipt } from "./port.js";

export type ScriptedTurn =
  | { tool: string; input: Record<string, unknown> }
  | { final: string };

export class ScriptedToolAdapter implements ToolUsePort {
  readonly route = "scripted/deterministic-v1";
  private i = 0;

  constructor(private readonly script: ScriptedTurn[]) {}

  async nextTurn(turn: ToolUseTurnRequest): Promise<ToolUseTurnResult> {
    const started = Date.now();
    const receipt: ModelCallReceipt = {
      provider: "scripted",
      model: "deterministic-v1",
      latency_ms: Date.now() - started + 1,
      input_chars: turn.system.length,
      output_chars: 10,
      ok: true,
      error_code: null,
    };

    const step = this.script[this.i];
    this.i++;
    if (!step) {
      return { kind: "text", text: "script exhausted", receipt };
    }
    if ("final" in step) {
      return { kind: "text", text: step.final, receipt };
    }
    return {
      kind: "tool_call",
      tool_use_id: `scripted_${this.i}`,
      tool_name: step.tool,
      input: step.input,
      receipt,
    };
  }
}
