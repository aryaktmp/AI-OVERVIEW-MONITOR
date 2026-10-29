"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/ringkasan", label: "Ringkasan" },
  { href: "/keyword", label: "Keyword" },
  { href: "/kompetitor", label: "Kompetitor" },
  { href: "/pengaturan", label: "Pengaturan" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigasi utama"
      className="my-5 flex gap-1 overflow-x-auto border-b border-[var(--line)]"
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap border-b-[3px] px-3.5 py-2.5 text-sm font-semibold transition-colors ${
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
