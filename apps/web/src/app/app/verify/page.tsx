import { listAllBrowserCaptures } from "@/server/app-layer";
import { Card, Button } from "@cockpit/ui/components";
import { CaptureLauncher } from "./capture-launcher";
import { DataTable, EmptyState } from "@cockpit/ui/components";
import { requirePageSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  await requirePageSession();
  const captures = listAllBrowserCaptures() as Array<{
    id: string;
    artifact_id: string | null;
    url: string;
    title: string | null;
    status: string;
    created_at: string;
    console_messages: Array<{ type: string; text: string }>;
    http_failures: Array<{ url: string; status: number }>;
  }>;

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Browser verification</h1>
          <p className="page-sub">
            Real headless Edge/Chrome (CDP). Loopback URLs only — the allowlist is enforced in code before launch.
            Screenshots, console errors, and HTTP failures are stored as evidence artifacts.
          </p>
        </div>
      </header>

      <CaptureLauncher />

      <Card title={`Captures (${captures.length})`}>
        {captures.length === 0 ? (
          <EmptyState
            title="No captures yet"
            body="Launch a capture above. The agent also calls this automatically via its browser_verify tool during runs."
          />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {captures.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 16, background: "var(--surface-2)" }}>
                <div className="row spread" style={{ marginBottom: 8 }}>
                  <div className="row">
                    <strong style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{c.url}</strong>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid",
                        color: c.status === "captured" ? "var(--ok)" : c.status === "failed" ? "var(--err)" : "var(--warn)",
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <span className="hint">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                {c.title && <p style={{ margin: "0 0 8px", color: "var(--text-dim)", fontSize: 13 }}>title: {c.title}</p>}

                <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                  {c.artifact_id ? (
                    <a href={`/api/v1/artifacts/${c.artifact_id}/content`} target="_blank" rel="noreferrer">
                      <img
                        src={`/api/v1/artifacts/${c.artifact_id}/content`}
                        alt={`screenshot of ${c.url}`}
                        width={360}
                        style={{ border: "1px solid var(--border)", borderRadius: 6, maxWidth: "100%" }}
                      />
                    </a>
                  ) : (
                    <div className="hint" style={{ width: 200 }}>no screenshot stored</div>
                  )}
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13 }}>Console ({c.console_messages.length})</p>
                    <pre className="diff" style={{ maxHeight: 120, overflow: "auto", margin: "0 0 8px" }}>
                      {c.console_messages.length === 0
                        ? "(none)"
                        : c.console_messages
                            .slice(0, 8)
                            .map((m) => `[${m.type}] ${m.text}`)
                            .join("\n")}
                    </pre>
                    <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13 }}>HTTP failures ({c.http_failures.length})</p>
                    <pre className="diff" style={{ maxHeight: 80, overflow: "auto", margin: 0 }}>
                      {c.http_failures.length === 0
                        ? "(none)"
                        : c.http_failures.map((f) => `${f.status} ${f.url}`).join("\n")}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>

  );
}
