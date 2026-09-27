import { listAllMemories } from "@/server/app-layer";
import { Card, Button } from "@cockpit/ui/components";
import { MemoryManager } from "./memory-manager";

export const dynamic = "force-dynamic";

export default function MemoryPage() {
  const memories = listAllMemories() as Array<{
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
  }>;

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Memory</h1>
          <p className="page-sub">
            Scoped project memory (Phase 4). Agent-written memories start <strong>unapproved</strong> — they influence
            plans and runs only after you approve them here. Inspect, edit, approve, expire, or delete anything.
          </p>
        </div>
        <a href="/api/v1/memories/export" download="cockpit-memories.json">
          <Button>Export JSON</Button>
        </a>
      </header>

      <MemoryManager memories={memories} />

      <Card title="How memory flows">
        <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-dim)", fontSize: 13.5, lineHeight: 1.7 }}>
          <li>
            The agent saves lessons/facts during runs via its <code>remember</code> tool — unapproved.
          </li>
          <li>You approve a memory here; it then feeds the context bundle for future plans.</li>
          <li>Context bundles show every memory they included, with provenance and confidence.</li>
          <li>Restricted memories auto-expire after 30 days; everything exports as portable JSON.</li>
        </ol>
      </Card>
    </>
  );
}
