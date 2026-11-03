"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/overview", legacyHref: "/ringkasan", label: "Overview" },
  { href: "/keywords", legacyHref: "/keyword", label: "Keywords & Batches" },
  { href: "/competitors", legacyHref: "/kompetitor", label: "Competitors" },
  { href: "/settings", legacyHref: "/pengaturan", label: "Settings" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="mt-2.5 flex gap-1 overflow-x-auto -mb-[1px]"
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          pathname === item.legacyHref ||
          pathname.startsWith(`${item.legacyHref}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap border-b-[2.5px] px-3.5 py-2 text-sm font-semibold transition-colors ${
              isActive
                ? "border-[var(--accent)] text-[var(--ink)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
