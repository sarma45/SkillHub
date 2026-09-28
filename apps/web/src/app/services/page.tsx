import Link from "next/link";
import { Card } from "@cockpit/ui/components";
import { authEnabled } from "@/server/auth";
import "./services.css";

export const metadata = {
  title: "Services — AI Engineering Cockpit",
  description:
    "Autonomous code-change runs, consent-gated memory, budgeted context, and verified browsing — the cockpit as a service.",
};

export const dynamic = "force-dynamic";

const TIERS = [
  {
    name: "Pilot",
    tag: "One repository, one bounded change at a time",
    price: "$950",
    per: "per change cycle",
    featured: false,
    points: [
      ["Repository onboarding", "read-only import + map, skill catalog, baseline security scan"],
      ["One autonomous run", "plan approval → isolated workspace → tests → review bundle"],
      ["Full evidence dossier", "events, receipts, unified diff, quality findings"],
    ],
  },
  {
    name: "Crew",
    tag: "The cockpit, operating on your team's behalf",
    price: "$3,400",
    per: "per month",
    featured: true,
    points: [
      ["Unlimited change cycles", "hash-bound plan approval on every single one"],
      ["Project memory with consent", "agent lessons captured; nothing influences work until approved"],
      ["Context bundles", "24k-char budget, provenance-labeled — see exactly what the planner saw"],
      ["Browser verification", "loopback UI capture: PNG, console, HTTP evidence per run"],
    ],
  },
  {
    name: "Fleet",
    tag: "Several repos, strict environments, self-hosted",
    price: "from $7,500",
    per: "per month",
    featured: false,
    points: [
      ["Everything in Crew", "plus multi-repo rollout and policy tuning"],
      ["Provider routing control", "deterministic, receipt-logged provider policy (BYO API keys)"],
      ["book-to-skill extraction", "team documentation → reviewable skill candidates"],
      ["Self-hosted deploy", "Docker image, your database, your network boundary"],
    ],
  },
] as const;

const FEATURES = [
  {
    name: "Autonomous code-change runs",
    claim: "verified",
    body: "Model proposes; policy disposes. Scoped tools, terminal budgets, durable event trail, bounded repair on failing tests.",
    machinery: "execution-engine · planning-service · model-gateway",
  },
  {
    name: "Project memory with consent",
    claim: "verified",
    body: "Agent-written memories start unapproved and influence nothing until a human approves them. Exportable, expiring, scoped.",
    machinery: "memory-service",
  },
  {
    name: "Budgeted context bundles",
    claim: "verified",
    body: "Every layer (project → file → memory) carries an inclusion reason and truncation is reported, never hidden.",
    machinery: "context-service",
  },
  {
    name: "Browser verification",
    claim: "verified",
    body: "Real CDP against installed Edge/Chrome, loopback-allowlisted before launch. PNG + console + HTTP evidence per capture.",
    machinery: "browser-service",
  },
  {
    name: "Deterministic provider routing",
    claim: "verified",
    body: "Versioned catalog, purpose-fit policy, a durable decision receipt for every routing call. BYO keys, no lock-in.",
    machinery: "routing-service",
  },
  {
    name: "book-to-skill extraction",
    claim: "verified",
    body: "Documentation becomes skill candidates — redacted, license-checked, and human-approved before activation.",
    machinery: "extraction-service · skill-registry",
  },
  {
    name: "Quality evaluators",
    claim: "verified",
    body: "Reproducible heuristics over real changed files: SEO basics, diagram coherence, design coherence — zero API cost.",
    machinery: "evaluation-service",
  },
  {
    name: "Authorization-first security scans",
    claim: "verified",
    body: "Scope-manifest gated scans of the local safe lab; preflight states honestly when the Strix binary is absent.",
    machinery: "security-service",
  },
] as const;

export default function ServicesPage() {
  const authed = authEnabled();

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Services</h1>
          <p className="page-sub">
            The AI Engineering Cockpit as an engagement: autonomous, evidence-first code changes with a human
            checkpoint on every consequential step.
          </p>
        </div>
      </header>

      <div className="services-tiers">
        {TIERS.map((t) => (
          <section key={t.name} className={`tier${t.featured ? " tier-featured" : ""}`}>
            <h2 className="tier-name">{t.name}</h2>
            <p className="tier-tag">{t.tag}</p>
            <p className="tier-price">
              {t.price} <small>{t.per}</small>
            </p>
            <ul>
              {t.points.map(([head, rest]) => (
                <li key={head}>
                  <strong>{head}</strong> — {rest}
                </li>
              ))}
            </ul>
            <div className="tier-cta">
              <Link className="button-link" href="/contact">
                Start with {t.name}
              </Link>
            </div>
          </section>
        ))}
      </div>

      <Card title="What you are actually buying">
        <p style={{ marginTop: 0, color: "var(--text-dim)" }}>
          Each capability below is an implemented service in this repository — not a roadmap item. The{" "}
          <span className="claim">verified</span> marks link to acceptance evidence in{" "}
          <code>docs/mvp/acceptance.md</code>.
        </p>
        <div className="services-map">
          {FEATURES.map((f) => (
            <div key={f.name} className="map-item">
              <h3>
                {f.name} <span className="claim">verified</span>
              </h3>
              <p>
                {f.body} <span className="machinery">{f.machinery}</span>
              </p>
            </div>
          ))}
        </div>
      </Card>

      <section className="honesty" style={{ marginTop: "var(--space-5)" }}>
        <h2>What this service deliberately does not do</h2>
        <ul>
          <li>
            <strong>No repository writes, ever.</strong> Import is read-only; execution happens in a disposable
            workspace copy.
          </li>
          <li>
            <strong>No blank-check autonomy.</strong> Every plan approval is hash-bound; every agent memory needs
            human consent; denied tools return errors to the model, not silent failures.
          </li>
          <li>
            <strong>No fake claims.</strong> Evidence is labeled <code>observed | verified | inferred | proposed |
            unknown</code>; when the Strix binary is missing, the scan says so instead of inventing findings.
          </li>
        </ul>
      </section>

      <div className="services-cta">
        <Link className="button-link" href="/contact">
          Book a pilot run
        </Link>
        <Link className="button-link-ghost" href={authed ? "/app/projects" : "/login"}>
          {authed ? "Open the cockpit" : "See it running (login)"}
        </Link>
      </div>
    </>
  );
}
