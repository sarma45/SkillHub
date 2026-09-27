import { ensureSeeded, listSkillCatalog, listSkillCandidates } from "@/server/app-layer";
import { Card, DataTable, KeyValue } from "@cockpit/ui/components";
import { StatusBadge, EvidenceLabelBadge } from "@cockpit/ui/badges";
import Link from "next/link";
import { ExtractionPanel } from "./extraction-panel";

export const dynamic = "force-dynamic";

const STATUS_ORDER: Record<string, number> = { approved: 0, reviewed: 1, candidate: 2, catalog_only: 3, deprecated: 4 };

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string }>;
}) {
  ensureSeeded();
  const { category, status } = await searchParams;
  const skills = listSkillCatalog() as Array<{
    skill_id: string; name: string; purpose: string; source_repo: string | null; source_url: string | null;
    license: string | null; category: string; phase: number | null; status: string;
  }>;

  const categories = [...new Set(skills.map((s) => s.category))].sort();
  const filtered = skills.filter(
    (s) => (!category || s.category === category) && (!status || s.status === status)
  );
  const sorted = [...filtered].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name)
  );

  const counts = {
    approved: skills.filter((s) => s.status === "approved").length,
    reviewed: skills.filter((s) => s.status === "reviewed").length,
    candidate: skills.filter((s) => s.status === "candidate").length,
    catalog_only: skills.filter((s) => s.status === "catalog_only").length,
  };

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Skill registry</h1>
          <p className="page-sub">
            {skills.length} entries: your starred repositories bound to product phases (master prompt §6B) plus first-party
            skills. Approved skills run; everything else is catalog data for humans.
          </p>
        </div>
      </header>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link href="/skills">all</Link>
        {categories.map((c) => (
          <Link key={c} href={`/skills?category=${c}`}>
            {c}
          </Link>
        ))}
        <span style={{ color: "var(--text-dim)" }}>|</span>
        <span className="hint" style={{ margin: 0 }}>
          {counts.approved} approved · {counts.reviewed} reviewed · {counts.candidate} candidate · {counts.catalog_only} catalog-only
        </span>
      </div>

      <ExtractionPanel />

      <Card title={`Catalog (${sorted.length})`}>
        <DataTable
          headers={["Skill", "Category", "Phase", "Status", "Source", "License"]}
          rows={sorted.map((s) => [
            <div key="n">
              <strong>{s.name}</strong>
              <div className="hint" style={{ marginTop: 2 }}>{s.purpose}</div>
            </div>,
            s.category,
            s.phase === null ? "—" : String(s.phase),
            <StatusBadge key="s" status={s.status === "approved" ? "passed" : s.status === "catalog_only" ? "cancelled" : "warning"} />,
            s.source_url ? (
              <a key="u" href={s.source_url} target="_blank" rel="noreferrer noopener" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {s.source_repo} ↗
              </a>
            ) : (
              <span className="hint">first-party</span>
            ),
            s.license ?? <span className="hint">unverified</span>,
          ])}
        />
      </Card>

      <Card title="Runtime binding rule">
        <p style={{ marginTop: 0 }}>
          Only <strong>approved</strong> skills are bound to the runtime — first-party skills (repository-exploration,
          plan-generation, safe-code-edit, autonomous-execution, project-memory, browser-verification, context-assembly)
          plus anything you approve from the extraction pipeline below. Reviewed entries shaped the product (design
          system, quality gates); candidates are integration targets behind capability flags; catalog-only entries are
          never activated (offensive toolkits stay reference-only).
        </p>
      </Card>
    </>
  );
}
