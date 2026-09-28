import { Card } from "@cockpit/ui/components";

export const metadata = {
  title: "Contact — AI Engineering Cockpit",
  description: "Book a pilot run or ask about Crew / Fleet engagements.",
};

export default function ContactPage() {
  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="page-title">Contact</h1>
          <p className="page-sub">
            Tell us which repository you want a bounded, evidence-first change on — and we&apos;ll scope the pilot.
          </p>
        </div>
      </header>

      <Card title="Start a conversation">
        <p style={{ marginTop: 0 }}>
          Email <a href="mailto:hello@example.com">hello@example.com</a> with:
        </p>
        <ul>
          <li>The repository (public GitHub URL is perfect for a pilot)</li>
          <li>The change you want — a bug, a feature, a migration</li>
          <li>Your definition of &quot;done&quot; (tests? browser-verified UI? both?)</li>
        </ul>
        <p className="hint">
          Every engagement includes the full evidence dossier: plan approval receipt, event trail, evaluator receipts,
          unified diff, and the workspace diff for human review.
        </p>
      </Card>

      <Card title="What happens next">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>We import your repo read-only and produce a repository map + baseline security scan.</li>
          <li>You approve a hash-bound plan before any code is written.</li>
          <li>The run executes in an isolated workspace with tests and quality evaluators.</li>
          <li>You review the diff and evidence — integration is always a human decision.</li>
        </ol>
      </Card>
    </>
  );
}
