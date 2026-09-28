"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { label: "Projects", href: "/app/projects", icon: "▦" },
  { label: "Compose", href: "/compose", icon: "✎" },
  { label: "Memory", href: "/app/memory", icon: "◷" },
  { label: "Verify", href: "/app/verify", icon: "✓" },
  { label: "Skills", href: "/skills", icon: "◇" },
  { label: "Security", href: "/security", icon: "⌑" },
  { label: "Services", href: "/services", icon: "⌘" },
  { label: "Permissions", href: "/app/settings/permissions", icon: "⚙" },
];

export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav className="sidenav" aria-label="Primary">
      <Link className="sidenav-brand" href="/app/projects" aria-label="SkillHub Studio home">
        <span className="brand-mark" aria-hidden="true">✳</span>
        <span>SkillHub <small>Studio</small></span>
      </Link>
      <span className="nav-caption">WORKSPACE</span>
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/app/projects" && pathname.startsWith(`${item.href}/`)) || (item.href === "/app/projects" && pathname.startsWith("/app/projects/"));
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "nav-active" : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </Link>
        );
      })}
      <div className="sidenav-foot">
        <span className="env-pill"><span className="env-dot" /> LOCAL WORKSPACE</span>
        <p className="nav-footnote">Your approvals. Your pace.</p>
      </div>
    </nav>
  );
}
