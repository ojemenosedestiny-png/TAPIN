"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme";
import { cn } from "@/lib/utils";
import { logout } from "@/app/(auth)/login/actions";
import type { Role } from "@/lib/auth/roles";
import { initials } from "./person-avatar";
import { navFor } from "./nav";

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  school_admin: "School admin",
  teacher: "Teacher",
};

export function Sidebar({ role, name, schoolName }: { role: Role; name: string; schoolName: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navFor(role);

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Menu</p>
      {items.map(({ href, label, icon: Icon }) => {
        const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
        const active = matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href));
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active ? "surface text-ink" : "text-muted-foreground hover:bg-muted/80 hover:text-ink",
            )}
          >
            {active && <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />}
            <span aria-hidden className={cn("flex size-7 items-center justify-center rounded-lg transition-colors",
              active ? "bg-brand text-primary-foreground shadow-sm dark:bg-brand-light dark:text-brand" : "bg-muted text-muted-foreground group-hover:text-ink")}>
              <Icon className="size-4" />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-3 border-t border-border p-4">
      <ThemeToggle />
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-xs font-semibold text-white ring-2 ring-card dark:from-brand-light dark:to-muted dark:text-brand">
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <Link href="/account" onClick={() => setOpen(false)} className="block truncate text-sm font-semibold text-ink hover:text-brand">{name}</Link>
          <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
        </div>
        <form action={logout}>
          <button type="submit" aria-label="Sign out" title="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ring">
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <div className="px-6 pb-3 pt-6">
      <Wordmark className="text-base" />
      {schoolName && (
        <p className="mt-4 flex items-center gap-2 truncate rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-ink ring-1 ring-inset ring-border">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate">{schoolName}</span>
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Wordmark className="text-sm" markClassName="size-8" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="rounded-lg p-2 text-ink hover:bg-muted"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="motion-rise absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-2xl">
            <div className="flex items-start justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="mt-5 rounded-lg p-2 hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>
    </>
  );
}
