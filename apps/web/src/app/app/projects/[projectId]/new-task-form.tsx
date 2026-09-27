"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@cockpit/ui/components";

export function NewTaskForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [request, setRequest] = useState("Add a bounded login feature");
  const [criteria, setCriteria] = useState("login greeting function exists\ntests pass");
  const [nonGoals, setNonGoals] = useState("OAuth\npassword reset");
  const [risk, setRisk] = useState("low");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `task-${projectId}-${Date.now()}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          request,
          success_criteria: criteria.split("\n").map((s) => s.trim()).filter(Boolean),
          non_goals: nonGoals.split("\n").map((s) => s.trim()).filter(Boolean),
          risk,
        }),
      });
      const body = (await res.json()) as { data?: { task_id?: string }; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      router.push(`/app/tasks/${body.data?.task_id}/plan`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor="task-request">What should change?</label>
      <input id="task-request" type="text" value={request} onChange={(e) => setRequest(e.target.value)} required minLength={8} />
      <p className="hint">One bounded outcome. The planner scopes it to the repository map.</p>

      <label htmlFor="task-criteria">Success criteria (one per line)</label>
      <textarea id="task-criteria" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />

      <label htmlFor="task-nongoals">Non-goals (one per line)</label>
      <textarea id="task-nongoals" rows={2} value={nonGoals} onChange={(e) => setNonGoals(e.target.value)} />

      <label htmlFor="task-risk">Risk</label>
      <select id="task-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="critical">critical</option>
      </select>

      <div style={{ marginTop: 16 }}>
        <Button type="submit" variant="primary" disabled={busy}>
          Frame task
        </Button>
      </div>
      {error && <p role="alert" style={{ color: "var(--err)", marginTop: 8 }}>{error}</p>}
    </form>
  );
}
