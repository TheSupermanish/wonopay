"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { RiCodeSSlashLine, RiDashboardLine, RiExchangeDollarLine, RiLogoutBoxRLine, RiSettings4Line } from "@remixicon/react";
import { DashboardSidebar, type DashboardNavItem } from "@/components/application/dashboard/dashboard-sidebar";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Logo } from "./logo";

const NAV: DashboardNavItem[] = [
  { key: "invoices", label: "Overview", icon: RiDashboardLine, href: "/dashboard" },
  { key: "payments", label: "Payments", icon: RiExchangeDollarLine, href: "/dashboard/payments" },
  { key: "developers", label: "Developers", icon: RiCodeSSlashLine, href: "/dashboard/developers" },
  { key: "settings", label: "Settings", icon: RiSettings4Line, href: "/dashboard/settings" },
];

function selectedKey(pathname: string): string {
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  if (pathname.startsWith("/dashboard/developers")) return "developers";
  if (pathname.startsWith("/dashboard/payments") || pathname.startsWith("/dashboard/invoices")) return "payments";
  return "invoices";
}

export function DashboardShell({ storeName, email, signOut, children }: {
  storeName: string;
  email: string;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const selected = selectedKey(pathname);
  const signOutForm = (
    <form action={signOut}>
      <Button type="submit" variant="secondary" leadingIcon={RiLogoutBoxRLine} className="w-full justify-start">Sign out</Button>
    </form>
  );
  return (
    <div className="flex min-h-dvh gap-4 p-0 lg:p-4">
      <div className="sticky top-4 hidden h-[calc(100dvh-2rem)] lg:block">
        <DashboardSidebar
          items={NAV}
          selected={selected}
          searchable={false}
          header={(collapsed) => (
            <span title={collapsed ? storeName : email}>
              <Logo subtitle={storeName} collapsed={collapsed} />
            </span>
          )}
          footer={signOutForm}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-separator-border px-4 py-3 lg:hidden">
          <Logo />
          <nav className="flex flex-wrap items-center gap-1" aria-label="Dashboard">
            {NAV.map((item) => (
              <ButtonLink key={item.key} href={item.href} size="small" variant={item.key === selected ? "secondary" : "ghost"} aria-current={item.key === selected ? "page" : undefined}>
                {item.label}
              </ButtonLink>
            ))}
            <ThemeToggle collapsed size="small" />
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-content min-w-0 flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
