"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialogCopy } from "@cockpit/ui/components";

export function PlanActions({
  taskId,
  mode,
  planVersion,
  planHash,
}: {
  taskId: string;
  mode: "generate" | "approve" | "view";
  planVersion?: number;
  planHash?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/plans`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
      });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok && res.status !== 202) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/plans/${planVersion}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({
          plan_hash: planHash,
          approved_by: "usr_owner",
          comment: "approved from plan UI",
        }),
      });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "generate") {
    return (
      <>
        <Button variant="primary" onClick={generate} disabled={busy}>
          Generate plan
        </Button>
        {error && <p role="alert" style={{ color: "var(--err)", marginTop: 8 }}>{error}</p>}
      </>
    );
  }

  if (mode === "approve") {
    return (
      <>
        <ConfirmDialogCopy
          what={`approve plan v${planVersion}`}
          scope="agent executes in an isolated copy; source repository untouched; every tool call is receipted"
          undo="cancel the run at any time; the workspace is disposable"
        />
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" onClick={approve} disabled={busy}>
            Approve plan v{planVersion}
          </Button>
        </div>
        {error && <p role="alert" style={{ color: "var(--err)", marginTop: 8 }}>{error}</p>}
      </>
    );
  }

  return null;
}
