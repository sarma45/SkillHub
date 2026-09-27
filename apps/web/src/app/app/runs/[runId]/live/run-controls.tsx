"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@cockpit/ui/components";

export function RunControls({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function control(action: "pause" | "resume" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/runs/${runId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setConfirmCancel(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "control failed");
    } finally {
      setBusy(false);
    }
  }

  const active = status === "running" || status === "queued";
  const paused = status === "paused";

  return (
    <div className="row">
      {active && (
        <Button onClick={() => control("pause")} disabled={busy}>
          Pause
        </Button>
      )}
      {paused && (
        <Button variant="primary" onClick={() => control("resume")} disabled={busy}>
          Resume
        </Button>
      )}
      {(active || paused) && !confirmCancel && (
        <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={busy}>
          Cancel…
        </Button>
      )}
      {confirmCancel && (
        <span className="row">
          <span style={{ color: "var(--warn)", fontSize: 13 }}>Cancel this run? Receipts are preserved.</span>
          <Button variant="danger" onClick={() => control("cancel")} disabled={busy}>
            Yes, cancel
          </Button>
          <Button onClick={() => setConfirmCancel(false)}>Keep running</Button>
        </span>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--err)", width: "100%" }}>
          {error}
        </p>
      )}
    </div>
  );
}
