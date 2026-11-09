"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { logout } from "@/app/(auth)/login/actions";
import type { Role } from "@/lib/auth/roles";
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
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warn",
              active ? "bg-brand-light text-brand-dark" : "text-muted-foreground hover:bg-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-border p-4">
      <p className="truncate text-sm font-medium text-ink">{name}</p>
      <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
      <form action={logout} className="mt-3">
        <button
          type="submit"
          className="flex items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-ink focus-visible:outline-2 focus-visible:outline-warn"
        >
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2 px-6 py-5">
      <Logo className="size-8" />
      <div className="min-w-0">
        <p className="font-heading text-lg font-semibold leading-tight text-ink">TapIn</p>
        {schoolName && <p className="truncate text-xs text-muted-foreground">{schoolName}</p>}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="font-heading font-semibold text-ink">TapIn</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="rounded-md p-2 text-ink hover:bg-muted"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-2 hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>
    </>
  );
}
