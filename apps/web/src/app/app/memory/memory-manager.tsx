"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, EmptyState, ErrorState, DataTable } from "@cockpit/ui/components";

export interface MemoryItem {
  id: string;
  scope: string;
  kind: string;
  content: string;
  confidence: number;
  created_by: string;
  approved: boolean;
  sensitivity: string;
  status: string;
  source_refs: string[];
  project_id: string | null;
  created_at: string;
}

export function MemoryManager({ memories }: { memories: MemoryItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState("all");
  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState("fact");
  const [newScope, setNewScope] = useState("project");

  const visible = memories.filter((m) => kindFilter === "all" || m.kind === kindFilter);

  async function act(id: string, action: "approve" | "expire" | "delete") {
    setBusyId(id + action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/memories/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as { errors?: Array<{ message: string }> };
      if (!res.ok) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function createMemory(e: React.FormEvent) {
    e.preventDefault();
    if (newContent.trim().length < 3) return;
    setError(null);
    try {
      const res = await fetch("/api/v1/memories", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify({
          scope: newScope,
          kind: newKind,
          content: newContent.trim(),
          confidence: 0.9,
        }),
      });
      const body = (await res.json()) as { errors?: Array<{ message: string }> };
      if (!res.ok) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
      setNewContent("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  }

  return (
    <>
      {error && <ErrorState title="Memory action failed" detail={error} />}

      <Card title="Add a memory">
        <form onSubmit={createMemory} className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 2, minWidth: 240 }}>
            <label htmlFor="mem-content">Content</label>
            <input
              id="mem-content"
              type="text"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="e.g. Always use npm test; never introduce jest"
            />
          </div>
          <div style={{ width: 140 }}>
            <label htmlFor="mem-kind">Kind</label>
            <select id="mem-kind" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
              {["fact", "preference", "decision", "lesson"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label htmlFor="mem-scope">Scope</label>
            <select id="mem-scope" value={newScope} onChange={(e) => setNewScope(e.target.value)}>
              {["user", "team", "project", "task"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary">
            Save memory
          </Button>
        </form>
        <p className="hint">Human-created memories are approved immediately; agent-written ones await your review.</p>
      </Card>

      <Card
        title={`Memories (${visible.length})`}
        actions={
          <select
            aria-label="Filter by kind"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            style={{ width: 160, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px" }}
          >
            <option value="all">all kinds</option>
            {["fact", "preference", "decision", "lesson"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            title="No memories yet"
            body="Memories appear when you save one above or when runs record lessons via the remember tool."
          />
        ) : (
          <DataTable
            headers={["Kind", "Content", "Scope", "By", "Status", "Confidence", "Actions"]}
            rows={visible.map((m) => [
              <strong key="k">{m.kind}</strong>,
              <span key="c">
                {m.content}
                {m.source_refs.length > 0 && (
                  <span className="hint" style={{ display: "block", fontFamily: "var(--font-mono)" }}>
                    {m.source_refs.slice(0, 2).join(" · ")}
                  </span>
                )}
              </span>,
              m.scope,
              m.created_by,
              m.status === "active" ? (
                m.approved ? (
                  <span style={{ color: "var(--ok)" }}>active · approved</span>
                ) : (
                  <span style={{ color: "var(--warn)" }}>awaiting approval</span>
                )
              ) : (
                <span>{m.status}</span>
              ),
              m.confidence.toFixed(2),
              <div key="a" className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                {!m.approved && (
                  <Button disabled={busyId === m.id + "approve"} onClick={() => act(m.id, "approve")}>
                    Approve
                  </Button>
                )}
                {m.status === "active" && (
                  <Button disabled={busyId === m.id + "expire"} onClick={() => act(m.id, "expire")}>
                    Expire
                  </Button>
                )}
                <Button variant="danger" disabled={busyId === m.id + "delete"} onClick={() => act(m.id, "delete")}>
                  Delete
                </Button>
              </div>,
            ])}
          />
        )}
      </Card>
    </>
  );
}
