import React from "react";

export function Card({ title, actions, children }: { title?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "20px",
        marginBottom: "var(--space-4)",
        boxShadow: "var(--shadow-1)",
      }}
      aria-label={title}
    >
      {(title || actions) && (
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {title ? <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  name?: string;
  value?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "#ffffff", border: "1px solid var(--accent)" },
    secondary: { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" },
    danger: { background: "transparent", color: "var(--err)", border: "1px solid var(--err)" },
  };
  return (
    <button
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles[variant],
        borderRadius: "var(--radius-sm)",
        padding: "8px 16px",
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "48px 28px",
        textAlign: "center",
        color: "var(--text-dim)",
        background: "var(--surface)",
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>{title}</p>
      <p style={{ margin: "0 0 16px" }}>{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title, detail, retry }: { title: string; detail: string; retry?: React.ReactNode }) {
  return (
    <div role="alert" style={{ border: "1px solid var(--err)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", background: "rgba(239,106,106,.06)" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--err)" }}>{title}</p>
      <p style={{ margin: "0 0 12px", color: "var(--text-dim)" }}>{detail}</p>
      {retry}
    </div>
  );
}

export function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" style={{ textAlign: "left", color: "var(--text-dim)", fontWeight: 600, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "8px 12px", verticalAlign: "top" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
      {items.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt style={{ color: "var(--text-dim)", margin: 0 }}>{k}</dt>
          <dd style={{ margin: 0, fontFamily: typeof v === "string" ? "var(--font-mono)" : undefined }}>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Progress that explains phases, not fake activity (master prompt: no fake activity). */
export function PhaseStepper({ phases, current }: { phases: string[]; current: string }) {
  return (
    <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0, margin: 0, flexWrap: "wrap" }}>
      {phases.map((p, i) => {
        const idx = phases.indexOf(current);
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        return (
          <li
            key={p}
            aria-current={state === "current" ? "step" : undefined}
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${state === "todo" ? "var(--border)" : state === "current" ? "var(--accent)" : "var(--ok)"}`,
              color: state === "todo" ? "var(--text-dim)" : state === "current" ? "var(--accent)" : "var(--ok)",
            }}
          >
            {p}
          </li>
        );
      })}
    </ol>
  );
}

export function ConfirmDialogCopy({ what, scope, undo }: { what: string; scope: string; undo: string }) {
  return (
    <div style={{ border: "1px solid var(--warn)", background: "rgba(230,180,85,.06)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}>
      <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Confirm: {what}</p>
      <p style={{ margin: "0 0 4px", color: "var(--text-dim)" }}>Scope: {scope}</p>
      <p style={{ margin: 0, color: "var(--text-dim)" }}>Recovery: {undo}</p>
    </div>
  );
}
