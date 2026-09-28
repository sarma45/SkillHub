import type { Metadata } from "next";
import "@cockpit/ui/tokens.css";
import "./shell.css";
import { PrimaryNav } from "@/components/primary-nav";

export const metadata: Metadata = {
  title: "SkillHub — AI Engineering Studio",
  description: "A calmer, more accountable workspace for building with AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="shell">
          <PrimaryNav />
          <main id="main" className="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
