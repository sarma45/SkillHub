import { getProjectById, getRepositoryMap, listProjectTasks } from "@/server/app-layer";
import { Card, Button, KeyValue, EmptyState, PhaseStepper } from "@cockpit/ui/components";
import { StatusBadge, EnvironmentBadge, RiskBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { NewTaskForm } from "../new-task-form";

export const dynamic = "force-dynamic";

const PHASES = ["Index", "Understand", "Plan", "Execute", "Verify", "Review"];

export default async function ProjectOverview({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProjectById(projectId);
  const mapData = getRepositoryMap(projectId);
  const tasks = listProjectTasks(projectId);
  const map = (mapData as { map: Record<string, unknown> | null }).map;

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <div className="row">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
              {project.source_type}:{project.source_ref}
            </span>
            <EnvironmentBadge env="local" />
            <StatusBadge status={project.status} />
          </div>
        </div>
      </header>

      <PhaseStepper phases={PHASES} current={project.status === "ready" ? "Understand" : "Index"} />

      <div className="grid-2" style={{ marginTop: 24 }}>
        <Card title="Repository">
          {map ? (
            <KeyValue
              items={[
                ["Languages", String((map.languages as string[])?.join(", ") ?? "—")],
                ["Framework", String(map.framework ?? "unknown")],
                ["Package manager", String(map.package_manager ?? "unknown")],
                ["Test command", String(map.test_command ?? "unknown")],
                ["Build command", String(map.build_command ?? "—")],
                ["Map version", String(map.map_version ?? 1)],
              ]}
            />
          ) : (
            <EmptyState
              title={project.status === "indexing" ? "Indexing in progress" : "Map not available"}
              body={
                project.status === "indexing"
                  ? "The worker is walking the file tree and detecting the stack. Refresh in a moment."
                  : `Indexing ${project.status}. Check the worker process is running.`
              }
            />
          )}
          <div style={{ marginTop: 16 }}>
            <Link href={`/app/projects/${projectId}/repository-map`}>
              <Button>Open repository map</Button>
            </Link>
          </div>
        </Card>

        <Card title="Create task">
          {project.status === "ready" ? (
            <NewTaskForm projectId={projectId} />
          ) : (
            <p className="hint">Available once indexing completes and the map is ready.</p>
          )}
        </Card>
      </div>

      <Card title="Tasks">
        {tasks.length === 0 ? (
          <p className="hint">No tasks yet. A task turns one bounded request into an approved plan.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {tasks.map((t) => (
              <li key={t.id} className="row spread" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, background: "var(--surface-2)" }}>
                <div className="row">
                  <Link href={`/app/tasks/${t.id}/plan`}>{t.request_text.slice(0, 80)}</Link>
                  <RiskBadge risk={t.risk} />
                </div>
                <StatusBadge status={t.state.toLowerCase()} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
