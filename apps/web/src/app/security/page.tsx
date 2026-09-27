import { ScanLauncher } from "./scan-launcher";
import { Card } from "@cockpit/ui/components";
import { strixStatus } from "@cockpit/security-service";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const strix = await strixStatus();

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Security center</h1>
          <p className="page-sub">
            Authorization-first scanning (master prompt security pack). Every scan runs behind a scope manifest; the only
            MVP target is the bundled vulnerable-app safe lab.
          </p>
        </div>
      </header>

      <Card title={`Strix binary — ${strix.ready ? "ready" : "not installed"}`}>
        {strix.ready ? (
          <p style={{ margin: 0 }}>
            Detected <strong style={{ fontFamily: "var(--font-mono)" }}>{strix.binary}</strong> ({strix.binary_source})
            {strix.version ? ` — ${strix.version}` : ""}. Scans launched in quick mode will run the real Strix agents
            against the safe-lab fixture.
          </p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              The baseline scanner (static, always available) covers the safe lab today. To activate live
              agentic penetration testing, complete this checklist:
            </p>
            <ol style={{ margin: "8px 0", paddingLeft: 20 }}>
              {strix.checklist.map((c) => (
                <li key={c} style={{ marginBottom: 4 }}>{c}</li>
              ))}
            </ol>
            <p className="hint">
              The adapter activates automatically once the binary answers to <code>--version</code> — no code changes
              needed. Until then scans run baseline-only and say so honestly.
            </p>
          </>
        )}
      </Card>

      <ScanLauncher />

      <Card title="Rules of engagement (MVP)">
        <ul>
          <li>Environment: <strong>local only</strong>. Staging/production/url targets are refused at the manifest gate.</li>
          <li>Actions: <strong>passive_scan</strong>. Exploit validation requires a security-owner approval flow outside MVP.</li>
          <li>Forbidden: destructive payloads, persistence, credential harvesting, DoS, exfiltration — enforced in code, not prompts.</li>
          <li>Rate limit 5 rps, 24h maximum window, explicit authorizer recorded with every scan.</li>
          <li>Findings are advisory until a human triages them; critical findings block integration.</li>
        </ul>
      </Card>

      <Card title="Verified test ladder (T0–T7)">
        <p className="hint" style={{ marginTop: 0 }}>
          MVP implements T0 (unit/policy tests), T1 (secret scan evaluator), T2 (agent-injection fixtures), T3 (local
          safe-lab scan: baseline scanner always; Strix binary adapter when installed). T4+ gates activate with the
          dormant capabilities.
        </p>
      </Card>
    </>
  );
}
