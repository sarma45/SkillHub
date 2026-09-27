"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, ErrorState } from "@cockpit/ui/components";

interface CaptureResult {
  capture_id: string;
  artifact_id: string | null;
  url: string;
  title: string | null;
  ok: boolean;
  error: string | null;
  console_messages: Array<{ type: string; text: string }>;
  http_failures: Array<{ url: string; status: number }>;
  page_errors: string[];
}

export function CaptureLauncher() {
  const router = useRouter();
  const [url, setUrl] = useState("http://localhost:3000/app/projects");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/browser/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json()) as { data?: CaptureResult; errors?: Array<{ message: string }> };
      if (!res.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
      setResult(body.data);
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "capture failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <ErrorState title="Capture failed" detail={error} />}
      <Card title="Launch a capture">
        <form onSubmit={launch} className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label htmlFor="cap-url">Loopback URL</label>
            <input id="cap-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000/..." />
            <p className="hint">Only http(s)://localhost / 127.0.0.1 are accepted — enforced server-side before launch.</p>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Capturing…" : "Capture screenshot"}
          </Button>
        </form>
      </Card>

      {result && (
        <Card title={`Last capture — ${result.ok ? "ok" : "failed"}`}>
          <p style={{ margin: "0 0 8px", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            {result.url} {result.title ? `— "${result.title}"` : ""}
          </p>
          {result.error && <p style={{ color: "var(--err)", margin: "0 0 8px" }}>{result.error}</p>}
          {result.artifact_id && (
            <a href={`/api/v1/artifacts/${result.artifact_id}/content`} target="_blank" rel="noreferrer">
              <img
                src={`/api/v1/artifacts/${result.artifact_id}/content`}
                alt={`screenshot of ${result.url}`}
                width={420}
                style={{ border: "1px solid var(--border)", borderRadius: 6, maxWidth: "100%" }}
              />
            </a>
          )}
          <pre className="diff" style={{ marginTop: 12, maxHeight: 140, overflow: "auto" }}>
            {[
              ...result.page_errors.map((t) => `[page-error] ${t}`),
              ...result.console_messages.map((m) => `[${m.type}] ${m.text}`),
              ...result.http_failures.map((f) => `[http ${f.status}] ${f.url}`),
            ].join("\n") || "(clean capture — no console errors, no HTTP failures)"}
          </pre>
        </Card>
      )}
    </>
  );
}
