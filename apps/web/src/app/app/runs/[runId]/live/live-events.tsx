"use client";

import { useEffect, useRef, useState } from "react";

export interface UiEvent {
  sequence: number;
  event_type: string;
  actor_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function LiveEvents({
  runId,
  initialEvents,
  initialCursor,
  terminal,
}: {
  runId: string;
  initialEvents: UiEvent[];
  initialCursor: number;
  terminal: boolean;
}) {
  const [events, setEvents] = useState<UiEvent[]>(initialEvents);
  const cursor = useRef(initialCursor);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (terminal) return;
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/runs/${runId}/events?cursor=${cursor.current}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { events?: UiEvent[]; next_cursor?: number } };
        const fresh = body.data?.events ?? [];
        if (stop) return;
        if (fresh.length > 0) {
          cursor.current = body.data?.next_cursor ?? cursor.current;
          setEvents((prev) => [...prev, ...fresh]);
          const last = fresh[fresh.length - 1]!;
          if (["run_paused", "run_cancelled", "run_failed", "run_completed", "human_checkpoint"].includes(last.event_type)) {
            setAnnouncement(`Run update: ${last.event_type.replace("run_", "").replace(/_/g, " ")}`);
          }
        }
      } catch {
        /* transient network error; keep polling */
      }
    }, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [runId, terminal]);

  return (
    <div>
      <div aria-live="polite" role="status" style={{ position: "absolute", left: -9999 }}>
        {announcement}
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 520, overflowY: "auto" }}>
        {events.map((e) => (
          <li
            key={e.sequence}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 10px",
              background: "var(--surface-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            <span style={{ color: actorColor(e.actor_type) }}>{e.actor_type}</span>{" "}
            <strong>{e.event_type}</strong>{" "}
            <span style={{ color: "var(--text-dim)" }}>{summarize(e.payload)}</span>
          </li>
        ))}
        {events.length === 0 && <li className="hint">Waiting for events…</li>}
      </ol>
    </div>
  );
}

function actorColor(actor: string): string {
  switch (actor) {
    case "agent": return "var(--accent)";
    case "evaluator": return "var(--ok)";
    case "security": return "var(--warn)";
    case "user": return "var(--text)";
    default: return "var(--text-dim)";
  }
}

function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${String(v).slice(0, 60)}`);
    }
  }
  return parts.slice(0, 4).join(" ");
}
