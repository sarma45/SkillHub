"use client";

import { useState } from "react";
import { Card, Button, ConfirmDialogCopy } from "@cockpit/ui/components";

export function ScanLauncher() {
  const [mode, setMode] = useState<"baseline" | "strix">("baseline");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({
          target: "security-fixtures/vulnerable-app",
          mode,
          authorizer: "local-owner (you)",
        }),
      });
      const body = (await res.json()) as { data?: { job_id: string; manifest_id: string }; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setResult(`Scan queued: job ${body.data?.job_id} under manifest ${body.data?.manifest_id}. The worker validates the manifest, then scans the fixture; findings appear in run evidence.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Launch a scan (local safe lab)">
      <div className="row">
        <label style={{ fontWeight: 600 }}>
          Scanner:{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as "baseline" | "strix")} style={{ width: "auto" }}>
            <option value="baseline">Baseline static scanner (built-in)</option>
            <option value="strix">Strix adapter (uses local strix binary if installed)</option>
          </select>
        </label>
      </div>
      <p className="hint">
        Target: <code style={{ fontFamily: "var(--font-mono)" }}>security-fixtures/vulnerable-app</code> — a deliberately
        vulnerable local fixture. Never deploy it, never point it at real data.
      </p>
      <ConfirmDialogCopy
        what={`run a ${mode} scan`}
        scope="single local fixture, passive scan, 5 rps, 1h window"
        undo="kill switch cancels workers; no credentials are ever used"
      />
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" onClick={launch} disabled={busy}>
          Validate manifest & scan
        </Button>
      </div>
      {result && <p style={{ color: "var(--ok)", marginTop: 10, fontSize: 13 }}>{result}</p>}
      {error && (
        <p role="alert" style={{ color: "var(--err)", marginTop: 10 }}>
          {error}
        </p>
      )}
    </Card>
  );
}
