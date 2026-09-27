"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@cockpit/ui/components";

export function ImportProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(source: { type: "fixture" | "local"; value: string }, projectName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `import-${projectName}-${Date.now()}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: projectName,
          source:
            source.type === "fixture"
              ? { type: "fixture", fixture_id: source.value }
              : { type: "local", path: source.value },
          permissions: { read: true, write: false },
        }),
      });
      const body = (await res.json()) as { data?: { project_id?: string }; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      router.push(`/app/projects/${body.data?.project_id}/overview`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Import a repository (read-only)">
      <div className="grid-2">
        <div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => submit({ type: "fixture", value: "sample-app" }, `sample-app-${Date.now().toString(36)}`)}
          >
            Import bundled sample-app
          </Button>
          <p className="hint">Safest path: a Next.js-shaped fixture with runnable tests. No npm install required.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name && path) submit({ type: "local", value: path }, name);
          }}
        >
          <label htmlFor="proj-name">Project name</label>
          <input id="proj-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-repo" required minLength={2} />
          <label htmlFor="proj-path">Local repository path</label>
          <input id="proj-path" type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\path\to\repo or /path/to/repo" required />
          <p className="hint">Read-only: the cockpit indexes the tree; it never writes to the source.</p>
          <div style={{ marginTop: 12 }}>
            <Button type="submit" disabled={busy || !name || !path}>
              Connect local repository
            </Button>
          </div>
        </form>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--err)", marginTop: 12 }}>
          {error}
        </p>
      )}
    </Card>
  );
}
