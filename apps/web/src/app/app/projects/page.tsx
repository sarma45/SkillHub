import { listAllProjects, ensureSeeded } from "@/server/app-layer";
import { EmptyState, Button } from "@cockpit/ui/components";
import { StatusBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { ImportProjectForm } from "./import-form";
import { requirePageSession } from "@/server/auth";
import "./projects.css";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await requirePageSession();
  ensureSeeded();
  const projects = listAllProjects();

  return (
    <>
      <header className="topbar projects-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1 className="page-title">Good work starts with<br className="desktop-break" /> a clear picture.</h1>
          <p className="page-sub">Bring a repository into a thoughtful, human-led AI workflow. Your source stays read-only while SkillHub builds a map you can inspect and shape.</p>
        </div>
      </header>

      <section className="trust-strip" aria-label="How SkillHub keeps you in control">
        <div className="trust-symbol" aria-hidden="true">✓</div>
        <div><strong>AI can be wrong. Your workflow stays reviewable.</strong><p>Actions are scoped, plans ask for your approval, and changes come with evidence for you to inspect.</p></div>
        <div className="trust-steps"><span>01&nbsp; Understand</span><span>02&nbsp; Approve</span><span>03&nbsp; Verify</span></div>
      </section>

      <ImportProjectForm />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Import the bundled sample-app fixture to try the full flow, or connect a local repository path. Nothing is written to your repository — ever."
          action={
            <Link href="/skills">
              <Button>Learn what the cockpit can do</Button>
            </Link>
          }
        />
      ) : (
        <section className="projects-section" aria-labelledby="connected-projects-title">
          <div className="section-heading"><div><p className="eyebrow">READY WHEN YOU ARE</p><h2 id="connected-projects-title">Your projects</h2></div><span className="project-count">{projects.length} connected</span></div>
          <div className="project-grid">
            {projects.map((p) => (
              <Link className="project-card" key={p.id} href={`/app/projects/${p.id}/overview`}>
                <div className="project-card-top"><span className="project-icon" aria-hidden="true">⌘</span><StatusBadge status={p.status} /></div>
                <h3>{p.name}</h3>
                <p className="project-source">{p.source_type} <span aria-hidden="true">·</span> {p.source_ref}</p>
                <span className="project-open">Open project <span aria-hidden="true">↗</span></span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
