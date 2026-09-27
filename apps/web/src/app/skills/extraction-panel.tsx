"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, ErrorState } from "@cockpit/ui/components";

interface Candidate {
  skill_id: string;
  name: string;
  purpose: string;
  license: string | null;
  license_confidence: string;
  workflow_steps: string[];
  triggers: string[];
  warnings: string[];
  status: string;
}

export function ExtractionPanel() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"text" | "directory">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Candidate | null>(null);

  async function extract(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body =
        mode === "text"
          ? { source: { kind: "text", text, title: title || "pasted-method" } }
          : { source: { kind: "directory", path: dirPath } };
      const res = await fetch("/api/v1/skills/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: { candidate: Candidate }; errors?: Array<{ message: string }> };
      if (!res.ok || !json.data) throw new Error(json.errors?.[0]?.message ?? `HTTP ${res.status}`);
      setResult(json.data.candidate);
      startTransition(() => router.refresh());
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "extraction failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(skillId: string, decision: "approve" | "reject" | "promote_reviewed") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/skills/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", skill_id: skillId, decision }),
      });
      const json = (await res.json()) as { errors?: Array<{ message: string }> };
      if (!res.ok) throw new Error(json.errors?.[0]?.message ?? `HTTP ${res.status}`);
      setResult((r) => (r ? { ...r, status: decision === "approve" ? "approved" : decision === "reject" ? "deprecated" : "reviewed" } : r));
      startTransition(() => router.refresh());
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Extract a skill from a source (book-to-skill pipeline)">
      <form onSubmit={extract}>
        <div className="row" style={{ gap: 12, marginBottom: 8 }}>
          <label style={{ margin: 0, fontWeight: 500 }}>
            <input
              type="radio"
              name="ex-mode"
              checked={mode === "text"}
              onChange={() => setMode("text")}
              style={{ width: "auto", marginRight: 6 }}
            />
            Paste markdown / notes
          </label>
          <label style={{ margin: 0, fontWeight: 500 }}>
            <input
              type="radio"
              name="ex-mode"
              checked={mode === "directory"}
              onChange={() => setMode("directory")}
              style={{ width: "auto", marginRight: 6 }}
            />
            Scan a local docs folder
          </label>
        </div>

        {mode === "text" ? (
          <>
            <label htmlFor="ex-title">Skill title</label>
            <input id="ex-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PR review method" />
            <label htmlFor="ex-text">Source document (min 200 chars)</label>
            <textarea
              id="ex-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"# My Method\n\nWhen to use: ...\n\n1. First step\n2. Second step\n3. Third step"}
            />
          </>
        ) : (
          <>
            <label htmlFor="ex-dir">Absolute path to a folder of .md/.txt docs</label>
            <input id="ex-dir" type="text" value={dirPath} onChange={(e) => setDirPath(e.target.value)} placeholder="C:\\path\\to\\docs" />
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Extracting…" : "Extract candidate skill"}
          </Button>
        </div>
      </form>

      {error && (
        <div style={{ marginTop: 12 }}>
          <ErrorState title="Extraction failed" detail={error} />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16, background: "var(--surface-2)" }}>
          <div className="row spread">
            <strong>{result.name}</strong>
            <span className="hint">
              license: {result.license ?? "none detected"} ({result.license_confidence})
            </span>
          </div>
          <p style={{ margin: "8px 0", fontSize: 13.5 }}>{result.purpose}</p>
          {result.workflow_steps.length > 0 && (
            <>
              <p style={{ margin: "4px 0", fontWeight: 600, fontSize: 13 }}>Detected workflow steps</p>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {result.workflow_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          {result.triggers.length > 0 && (
            <p className="hint" style={{ marginTop: 8 }}>triggers: {result.triggers.slice(0, 3).join(" · ")}</p>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} style={{ margin: "6px 0 0", color: "var(--warn)", fontSize: 13 }}>⚠ {w}</p>
          ))}
          <p className="hint" style={{ marginTop: 10 }}>
            Status: <strong>{result.status}</strong> — candidates never run until you approve them (human review gate).
          </p>
          {result.status === "candidate" && (
            <div className="row" style={{ marginTop: 10 }}>
              <Button disabled={busy} onClick={() => review(result.skill_id, "approve")}>
                Approve (activates)
              </Button>
              <Button disabled={busy} onClick={() => review(result.skill_id, "promote_reviewed")}>
                Mark reviewed
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => review(result.skill_id, "reject")}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
