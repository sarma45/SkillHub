import { getRepositoryMap } from "@/server/app-layer";
import { Card, KeyValue, EmptyState } from "@cockpit/ui/components";
import { EvidenceLabelBadge, StatusBadge } from "@cockpit/ui/badges";
import { FactEditor } from "./fact-editor";
import type { RepositoryMap, TreeNode } from "@cockpit/contracts";
import { requirePageSession } from "@/server/auth";

export const dynamic = "force-dynamic";

function TreeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
      <div style={{ paddingLeft: depth * 14, color: node.type === "dir" ? "var(--text)" : "var(--text-dim)" }}>
        {node.type === "dir" ? "▸ " : "· "}
        {node.name}
      </div>
      {(node.children ?? []).map((c) => (
        <TreeView key={c.path} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export default async function RepositoryMapPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requirePageSession();
  const { projectId } = await params;
  const data = getRepositoryMap(projectId) as {
    status: string;
    map: RepositoryMap | null;
    confidence_note?: string;
  };

  if (!data.map) {
    return (
      <>
        <h1 className="page-title">Repository map</h1>
        <EmptyState
          title={data.status === "indexing" ? "Indexing…" : "Map unavailable"}
          body={
            data.status === "indexing"
              ? "The worker is building the map. This page shows phases, not raw logs — refresh shortly."
              : "Indexing failed or has not run. Ensure the worker is running, then retry from project overview."
          }
        />
      </>
    );
  }

  const map = data.map;
  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Repository map</h1>
          <p className="page-sub">{data.confidence_note}</p>
        </div>
        <StatusBadge status={data.status} />
      </header>

      <div className="grid-2">
        <Card title={`Directory tree (v${map.map_version})`}>
          <TreeView node={map.tree} />
        </Card>

        <div>
          <Card title="Detected facts">
            <KeyValue
              items={[
                ["Languages", map.languages.join(", ") || "—"],
                ["Framework", map.framework ?? "unknown"],
                ["Package manager", map.package_manager ?? "unknown"],
                ["Entry points", map.entry_points.join(", ") || "—"],
                ["Build", map.build_command ?? "—"],
                ["Test", map.test_command ?? "unknown"],
              ]}
            />
            <h3 style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 20 }}>Facts & confidence</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {map.facts.map((f) => (
                <li key={f.key} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div className="row spread">
                    <strong style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{f.key}</strong>
                    <EvidenceLabelBadge label={f.label} />
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, marginTop: 2 }}>{f.value}</div>
                  <div className="hint">sources: {f.source_refs.join(", ") || "none"}</div>
                </li>
              ))}
            </ul>
            <FactEditor facts={map.facts.map((f) => f.key)} projectId={projectId} />
          </Card>

          {map.unresolved_questions.length > 0 && (
            <Card title="Unresolved questions">
              <ul>
                {map.unresolved_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
