import { listAllProjects, ensureSeeded } from "@/server/app-layer";
import { Card, EmptyState, Button } from "@cockpit/ui/components";
import { StatusBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { ImportProjectForm } from "./import-form";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  ensureSeeded();
  const projects = listAllProjects();

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">Connect a repository read-only to build an editable map.</p>
        </div>
      </header>

      <ImportProjectForm />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Import the bundled sample-app fixture to try the full flow, or connect a local repository path. Nothing is written to your repository — ever."
          action={
            <Link href="/skills">
              <Button>Learn what the cockpit can do</Button>
            </Link>
          }
        />
      ) : (
        <Card title="Connected projects">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {projects.map((p) => (
              <li key={p.id} className="row spread" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, background: "var(--surface-2)" }}>
                <div className="row">
                  <Link href={`/app/projects/${p.id}/overview`} style={{ fontWeight: 600 }}>
                    {p.name}
                  </Link>
                  <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {p.source_type}:{p.source_ref}
                  </span>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
