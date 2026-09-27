"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialogCopy } from "@cockpit/ui/components";

export function PrDraftPanel({
  runId,
  hasBlocking,
  existing,
}: {
  runId: string;
  hasBlocking: boolean;
  existing: { draft_id: string; status: string; payload: Record<string, unknown> } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(existing);

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/runs/${runId}/pull-request-draft`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `prd-${runId}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          branch: "cockpit/bounded-change",
          title: "Bounded change via AI Engineering Cockpit",
          body: "Implements the approved plan with evidence receipts. Generated in an isolated workspace; reviewed by a human before submission.",
          acknowledged_risks: ack,
        }),
      });
      const body = (await res.json()) as { data?: { draft_id: string; status: string; payload: Record<string, unknown> }; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setDraft(body.data!);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/runs/${runId}/pull-request-draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({ action: "approve" }),
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

  if (draft) {
    return (
      <div>
        <p>
          Draft <code style={{ fontFamily: "var(--font-mono)" }}>{draft.draft_id}</code> —{" "}
          <strong>{draft.status.replace(/_/g, " ")}</strong>
        </p>
        <ConfirmDialogCopy
          what="approve this draft for submission"
          scope="GitHub submission capability is DORMANT in MVP — approval records human intent only; the payload stays local"
          undo="draft remains inspectable; nothing external has happened"
        />
        {draft.status === "draft_pending_approval" && (
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={approveDraft} disabled={busy}>
              Approve draft (local only)
            </Button>
          </div>
        )}
        {error && <p role="alert" style={{ color: "var(--err)", marginTop: 8 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {hasBlocking && (
        <p role="alert" style={{ color: "var(--err)" }}>
          Blocking findings must be resolved before a PR draft can be created.
        </p>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400 }}>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>
          I reviewed the diff and evidence. I acknowledge unresolved risks and want to create a
          pull-request <strong>draft</strong> (local record only — external submission is disabled in MVP).
        </span>
      </label>
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" onClick={createDraft} disabled={busy || !ack || hasBlocking}>
          Create PR draft
        </Button>
      </div>
      <p className="hint">
        Nothing is submitted anywhere in MVP. The draft records the exact payload for human approval.
      </p>
      {error && <p role="alert" style={{ color: "var(--err)", marginTop: 8 }}>{error}</p>}
    </div>
  );
}
