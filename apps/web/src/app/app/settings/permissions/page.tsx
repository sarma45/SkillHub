import { listCapabilities } from "@cockpit/policy";
import { Card, DataTable } from "@cockpit/ui/components";
import { StatusBadge } from "@cockpit/ui/badges";
import { ensureSeeded } from "@/server/app-layer";

export const dynamic = "force-dynamic";

export default function PermissionsPage() {
  ensureSeeded();
  const caps = listCapabilities();
  const enabled = caps.filter((c) => c.status === "enabled");
  const dormant = caps.filter((c) => c.status === "dormant");

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Permissions & capabilities</h1>
          <p className="page-sub">
            Capability flags are enforced server-side. Dormant capabilities have no reachable API behavior — not merely
            hidden UI.
          </p>
        </div>
      </header>

      <Card title={`Enabled (${enabled.length})`}>
        <DataTable
          headers={["Capability", "Phase", "Scopes", "Purpose"]}
          rows={enabled.map((c) => [
            <code key="i" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.capability_id}</code>,
            String(c.required_phase),
            <span key="p" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{c.required_permissions.join(", ") || "—"}</span>,
            c.note,
          ])}
        />
      </Card>

      <Card title={`Dormant (${dormant.length})`}>
        <p className="hint" style={{ marginTop: 0 }}>
          These stay off until their phase gates pass. Enabling them requires the capability-flag registry, a human owner,
          and passing evaluations.
        </p>
        <DataTable
          headers={["Capability", "Phase", "Why dormant"]}
          rows={dormant.map((c) => [
            <code key="i" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.capability_id}</code>,
            String(c.required_phase),
            c.note,
          ])}
        />
      </Card>

      <Card title="Local auth stub">
        <p>
          Single-org local mode: owner role with full scopes. Multi-user identity is a standard-mode decision
          (TRD §16.1) — never improvised in the MVP.
        </p>
      </Card>
    </>
  );
}
