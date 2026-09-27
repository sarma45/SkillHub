import type { Metadata } from "next";
import Link from "next/link";
import "@cockpit/ui/tokens.css";
import "./shell.css";

export const metadata: Metadata = {
  title: "AI Engineering Cockpit",
  description: "Human-centered AI engineering workspace: understand, plan, execute, verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="shell">
          <nav className="sidenav" aria-label="Primary">
            <div className="sidenav-brand">
              <span className="brand-mark" aria-hidden>
                ◈
              </span>
              <span>Cockpit</span>
            </div>
            <Link href="/app/projects">Projects</Link>
            <Link href="/app/memory">Memory</Link>
            <Link href="/app/verify">Verify</Link>
            <Link href="/skills">Skills</Link>
            <Link href="/security">Security</Link>
            <Link href="/app/settings/permissions">Permissions</Link>
            <div className="sidenav-foot">
              <span className="env-pill">env: local</span>
            </div>
          </nav>
          <main id="main" className="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
