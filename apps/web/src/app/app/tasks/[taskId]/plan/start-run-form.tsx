"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, ConfirmDialogCopy } from "@cockpit/ui/components";

export function StartRunForm({ taskId, planHash }: { taskId: string; planHash: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "autonomous">("autonomous");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `run-${taskId}-${Date.now()}`,
        },
        body: JSON.stringify({
          plan_hash: planHash,
          workspace: "isolated",
          max_duration_ms: 900_000,
          max_retries: 2,
          mode,
        }),
      });
      const body = (await res.json()) as { data?: { run_id: string }; errors?: Array<{ message: string }> };
      if (!res.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
      router.push(`/app/runs/${body.data.run_id}/live`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row" style={{ alignItems: "flex-end", gap: 12, marginTop: 12 }}>
        <div>
          <label htmlFor="run-mode">Execution mode</label>
          <select
            id="run-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "normal" | "autonomous")}
            style={{ width: 260 }}
          >
            <option value="autonomous">Autonomous — model-driven tool loop</option>
            <option value="normal">Deterministic — template executor</option>
          </select>
        </div>
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy ? "Starting…" : "Start run"}
        </Button>
      </div>
      <p className="hint">
        Autonomous mode: the model proposes each tool call; scopes, budgets, and stop conditions are still enforced in
        code. Final tests run regardless of the model's behavior. With <code>ANTHROPIC_API_KEY</code> set this is fully
        model-driven; without one it uses the deterministic scripted loop.
      </p>
      {error && <ErrorState title="Run did not start" detail={error} />}
    </>
  );
}
