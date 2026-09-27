"use client";

import { useState } from "react";
import { Button } from "@cockpit/ui/components";

export function FactEditor({ projectId, facts }: { projectId: string; facts: string[] }) {
  const [key, setKey] = useState(facts[0] ?? "");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/repository-map`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({ key, value, reason: "manual correction from map UI" }),
      });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setSaved(`${key} → ${value}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "correction failed");
    }
  }

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <h3 style={{ fontSize: 13, color: "var(--text-dim)" }}>Correct a fact</h3>
      <label htmlFor="fact-key">Fact</label>
      <select id="fact-key" value={key} onChange={(e) => setKey(e.target.value)}>
        {facts.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <label htmlFor="fact-value">Corrected value</label>
      <input id="fact-value" type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. pnpm" />
      <div style={{ marginTop: 10 }}>
        <Button onClick={save} disabled={!value}>
          Save correction
        </Button>
      </div>
      {saved && <p style={{ color: "var(--ok)", fontSize: 13, marginTop: 8 }}>Saved: {saved}</p>}
      {error && (
        <p role="alert" style={{ color: "var(--err)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
