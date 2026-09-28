import React from "react";

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  passed: { fg: "#1a7f37", bg: "#eaf6ed" },
  ready: { fg: "#1a7f37", bg: "#eaf6ed" },
  approved: { fg: "#1a7f37", bg: "#eaf6ed" },
  failed: { fg: "#cf222e", bg: "#fff0ef" },
  cancelled: { fg: "#656d76", bg: "#f0f1f3" },
  needs_repair: { fg: "#825f00", bg: "#fff5d6" },
  warning: { fg: "#825f00", bg: "#fff5d6" },
  indexing: { fg: "#0969da", bg: "#eaf2fd" },
  running: { fg: "#0969da", bg: "#eaf2fd" },
  queued: { fg: "#656d76", bg: "#f0f1f3" },
  paused: { fg: "#825f00", bg: "#fff5d6" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { fg: "#656d76", bg: "#f0f1f3" };
  return (
    <span
      className="badge"
      style={{
        color: c.fg,
        background: c.bg,
        border: `1px solid ${c.fg}33`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const RISK_COLORS: Record<string, string> = {
  low: "#1a7f37",
  medium: "#825f00",
  high: "#cf222e",
  critical: "#cf222e",
};

export function RiskBadge({ risk }: { risk: string }) {
  const fg = RISK_COLORS[risk] ?? "#9aa8b5";
  return (
    <span
      className="badge"
      style={{
        color: fg,
        border: `1px solid ${fg}55`,
        borderRadius: 4,
        padding: "1px 8px",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      risk: {risk}
    </span>
  );
}

export function EnvironmentBadge({ env }: { env: string }) {
  const isLocal = env === "local";
  return (
    <span
      className="badge"
      style={{
        color: isLocal ? "#0969da" : "#825f00",
        border: `1px dashed ${isLocal ? "#0969da66" : "#825f0066"}`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      env: {env}
    </span>
  );
}

export function EvidenceLabelBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        color: "#656d76",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "1px 8px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
      }}
      title="Evidence label: observed/verified/inferred/proposed/unknown"
    >
      {label}
    </span>
  );
}
