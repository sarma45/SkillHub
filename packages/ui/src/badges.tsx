import React from "react";

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  passed: { fg: "#3ecf8e", bg: "rgba(62,207,142,.12)" },
  ready: { fg: "#3ecf8e", bg: "rgba(62,207,142,.12)" },
  approved: { fg: "#3ecf8e", bg: "rgba(62,207,142,.12)" },
  failed: { fg: "#ef6a6a", bg: "rgba(239,106,106,.12)" },
  cancelled: { fg: "#9aa8b5", bg: "rgba(154,168,181,.12)" },
  needs_repair: { fg: "#e6b455", bg: "rgba(230,180,85,.12)" },
  warning: { fg: "#e6b455", bg: "rgba(230,180,85,.12)" },
  indexing: { fg: "#4da3ff", bg: "rgba(77,163,255,.12)" },
  running: { fg: "#4da3ff", bg: "rgba(77,163,255,.12)" },
  queued: { fg: "#9aa8b5", bg: "rgba(154,168,181,.12)" },
  paused: { fg: "#e6b455", bg: "rgba(230,180,85,.12)" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { fg: "#9aa8b5", bg: "rgba(154,168,181,.12)" };
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
  low: "#3ecf8e",
  medium: "#e6b455",
  high: "#ef6a6a",
  critical: "#ef6a6a",
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
        color: isLocal ? "#4da3ff" : "#e6b455",
        border: `1px dashed ${isLocal ? "#4da3ff66" : "#e6b45566"}`,
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
        color: "#9aa8b5",
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
