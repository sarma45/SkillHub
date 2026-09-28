"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateTaskRequest } from "@cockpit/contracts";
import { Button } from "@cockpit/ui/components";
import { compileIdeaToBrief, type Risk } from "@/lib/idea-compiler";

interface ProjectLite {
  id: string;
  name: string;
  source_type: string;
}

type Phase = "idle" | "creating" | "queued" | "planning" | "done" | "error";

const RISKS: Risk[] = ["low", "medium", "high", "critical"];
const PLAN_POLL_MS = 2000;
const PLAN_POLL_MAX = 30;
const MAX_REQUEST = 4000;

export function ComposeClient() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [projects, setProjects] = useState<ProjectLite[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [riskOverride, setRiskOverride] = useState<Risk | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempts, setAttempts] = useState(0);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Compile live as the user types; silent while below the contract minimum.
  const compiled = useMemo(() => {
    const text = idea.trim();
    if (text.length < 8) return null;
    try {
      return compileIdeaToBrief(text);
    } catch {
      return null;
    }
  }, [idea]);

  const brief = compiled?.brief ?? null;

  // Live Zod validation against the real contract — same parser the API uses.
  const schemaCheck = useMemo(() => {
    if (!brief) return null;
    const res = CreateTaskRequest.safeParse(brief);
    return res.success ? true : res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }, [brief]);

  const effectiveRisk = (riskOverride ?? brief?.risk ?? "low") as Risk;
  const canSend = Boolean(brief && projectId && !sending && schemaCheck === true);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/projects", { cache: "no-store" });
      if (res.status === 401) {
        setMessage({ kind: "error", text: "Session expired — reload and log in again." });
        setProjects(null);
        return;
      }
      const body = await res.json();
      setProjects(body?.data?.projects ?? []);
    } catch {
      setMessage({ kind: "error", text: "Could not load projects — is the server running?" });
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function send() {
    if (!brief || !projectId) return;
    setSending(true);
    setMessage(null);
    setLastTaskId(null);
    setPhase("creating");
    const payload = { ...brief, risk: effectiveRisk };
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // the API requires this for mutations (8–200 chars)
          "Idempotency-Key": crypto.randomUUID(),
          // the API honors x-request-id for the response envelope
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      // create-task returns { task_id, status, brief_version }
      const taskId: string | undefined = body?.data?.task_id ?? body?.data?.id;
      if (!(res.status === 200 || res.status === 201) || !taskId) {
        setPhase("error");
        setMessage({ kind: "error", text: body?.error?.message ?? `Unexpected response (${res.status}).` });
        return;
      }
      setLastTaskId(taskId);

      // One click continues the funnel: queue plan generation on the worker.
      setPhase("queued");
      const planRes = await fetch(`/api/v1/tasks/${taskId}/plans`, {
        method: "POST",
        headers: { "x-request-id": crypto.randomUUID() },
      });
      if (planRes.status !== 202 && !planRes.ok) {
        const pbody = await planRes.json().catch(() => null);
        setPhase("error");
        setMessage({ kind: "error", text: pbody?.error?.message ?? "Could not queue plan generation." });
        return;
      }

      setPhase("planning");
      const planned = await waitForPlan(taskId);
      if (!alive.current) return;
      if (!planned) {
        setPhase("error");
        setMessage({
          kind: "error",
          text: "Worker has not produced a plan in time — the task exists; open it to retry.",
        });
        return;
      }
      setPhase("done");
      router.push(`/app/tasks/${taskId}/plan`);
    } catch {
      if (!alive.current) return;
      setPhase("error");
      setMessage({ kind: "error", text: "Network error — the brief was not sent." });
    } finally {
      setSending(false);
    }
  }

  /** Polls the task until the worker reaches AWAITING_PLAN_APPROVAL. Honest timeout after ~60s. */
  async function waitForPlan(taskId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= PLAN_POLL_MAX; attempt++) {
      if (!alive.current) return false;
      setAttempts(attempt);
      await new Promise((r) => setTimeout(r, PLAN_POLL_MS));
      try {
        const res = await fetch(`/api/v1/tasks/${taskId}`, { cache: "no-store" });
        if (res.status === 401) {
          if (alive.current) setMessage({ kind: "error", text: "Session expired — log in again." });
          return false;
        }
        if (!res.ok) continue; // transient error — keep polling
        const body = await res.json();
        const state: string | undefined = body?.data?.state;
        if (state === "AWAITING_PLAN_APPROVAL" || body?.data?.latest_plan) return true;
      } catch {
        // transient network error — keep polling
      }
    }
    return false;
  }

  return (
    <div className="compose-grid">
      <div className="compose-card">
        <h2>Idea</h2>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={"e.g. A booking dashboard for a small dental clinic.\nUsers can confirm today's appointments with one click.\nThe system sends a confirmation email.\nDo not support online payments."}
          maxLength={MAX_REQUEST}
          aria-label="Idea text"
        />
        <div className="compose-meta">
          <span>{idea.trim().length} / {MAX_REQUEST}</span>
          {compiled ? <span>· deterministic preview live</span> : <span>· {idea.trim().length === 0 ? "waiting for input" : "8+ characters to compile"}</span>}
        </div>

        <div className="compose-actions">
          <Button variant="primary" type="button" disabled={!canSend} onClick={() => void send()}>
            {phase === "creating" ? "Framing…" : phase === "queued" || phase === "planning" ? "Planning…" : "Send to cockpit"}
          </Button>
          <Button variant="secondary" type="button" disabled={!idea || sending} onClick={() => { setIdea(""); setRiskOverride(null); setMessage(null); setPhase("idle"); }}>
            Clear
          </Button>
          {phase === "creating" && <p className="compose-phase" role="status">framing task…</p>}
          {phase === "queued" && <p className="compose-phase" role="status">plan generation queued — worker polling…</p>}
          {phase === "planning" && <p className="compose-phase" role="status">waiting for plan (attempt {attempts}/{PLAN_POLL_MAX})…</p>}
          {phase === "error" && lastTaskId && (
            <a className="compose-phase" href={`/app/tasks/${lastTaskId}/plan`}>
              open task plan page →
            </a>
          )}
          {message && (
            <p className="compose-message" data-kind={message.kind} role="status">
              {message.text}
            </p>
          )}
        </div>
      </div>

      <div className="compose-card">
        <h2>Compiled brief</h2>
        {!brief ? (
          <p className="hint" style={{ margin: 0 }}>
            The structured brief appears here as you type — success criteria, non-goals, risk — each with the rule
            that produced it.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="risk-row">
              <span className="hint" style={{ margin: 0 }}>Derived risk:</span>
              {RISKS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`risk-pill risk-${r}`}
                  aria-pressed={effectiveRisk === r}
                  onClick={() => setRiskOverride(r === brief.risk ? null : r)}
                  title={r === "critical" ? "Never auto-set — human decision only" : `Override risk to ${r}`}
                >
                  {r}
                </button>
              ))}
            </div>

            <div>
              <h2 style={{ marginBottom: 4 }}>Success criteria</h2>
              <ol className="compact-list">
                {brief.success_criteria.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </div>

            <div>
              <h2 style={{ marginBottom: 4 }}>Non-goals</h2>
              <ul className="compact-list">
                {brief.non_goals.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>

            <div>
              <h2 style={{ marginBottom: 4 }}>Provenance</h2>
              <ul className="prov-list">
                {(compiled?.provenance ?? []).map((p) => (
                  <li key={p.field}>
                    <span className="prov-field">{p.field}</span>
                    <span className="prov-rule">{p.rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            {schemaCheck !== true && Array.isArray(schemaCheck) && (
              <p className="compose-message" data-kind="error">
                {schemaCheck.join("; ")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="compose-card" style={{ gridColumn: "1 / -1" }}>
        <h2>Target project</h2>
        {projects === null ? (
          <p className="hint" style={{ margin: 0 }}>Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            No projects yet — import one on the <a href="/app/projects">Projects</a> page first.
          </p>
        ) : (
          <div className="proj-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="proj"
                aria-pressed={projectId === p.id}
                onClick={() => setProjectId(p.id)}
              >
                <span className="proj-name">{p.name}</span>
                <span className="proj-type">{p.source_type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
