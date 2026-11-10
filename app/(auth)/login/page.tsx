import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Logo, TAGLINE } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme/theme";
import { LoginForm } from "./login-form";

export const instant = true;

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  idle: "You were signed out after 30 minutes of inactivity.",
  link: "That link has expired or was already used. Ask for a new one below.",
};

type SearchParams = Promise<{ reason?: string }>;

async function LoginFormWithNotice({ searchParams }: { searchParams: SearchParams }) {
  const { reason } = await searchParams;
  return <LoginForm notice={reason ? NOTICES[reason] : undefined} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="space-y-2"><Skeleton className="h-4 w-12" /><Skeleton className="h-9 w-full" /></div>
      <div className="space-y-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-9 w-full" /></div>
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

const POINTS = [
  ["Every arrival, on the record", "A tap at the gate signs a child in, with their photo for the guard to check."],
  ["Parents know straight away", "An SMS or WhatsApp the moment their child arrives, leaves or is absent."],
  ["Answers for the head teacher", "Who is in school right now, who is often late, and reports in one click."],
] as const;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main id="main" className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section aria-hidden className="relative hidden overflow-hidden bg-[#06302c] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_100%_0%,rgb(45_212_191/0.28),transparent_60%),radial-gradient(600px_400px_at_0%_100%,rgb(245_158_11/0.14),transparent_60%)]" />
        {/* NFC rings */}
        <svg className="absolute -right-24 top-1/2 size-[560px] -translate-y-1/2 text-white/[0.07]" viewBox="0 0 200 200" fill="none" stroke="currentColor">
          {[30, 52, 74, 96].map((r) => <circle key={r} cx="100" cy="100" r={r} strokeWidth="1.2" />)}
        </svg>
        <div className="relative flex items-center gap-3">
          <Logo className="size-11" variant="inverse" title="" />
          <span className="font-heading text-2xl font-bold tracking-tight">Tap<span className="text-amber-400">In</span></span>
        </div>
        <div className="relative max-w-md">
          <p className="font-heading text-4xl font-semibold leading-[1.1] tracking-tight">Every child.<br />Accounted for.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(([title, body], i) => (
              <li key={title} className="motion-rise flex gap-4" style={{ "--d": `${200 + i * 90}ms` } as React.CSSProperties}>
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-teal-300 shadow-[0_0_0_4px_rgb(94_234_212/0.15)]" />
                <span><span className="block font-medium">{title}</span><span className="mt-0.5 block text-sm leading-6 text-white/65">{body}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/45">NFC attendance for schools in Nigeria</p>
      </section>

      {/* Form */}
      <section className="canvas relative flex items-center justify-center px-4 py-12">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="motion-rise w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <Logo className="size-14 lg:hidden" />
            <h1 className="mt-4 text-3xl font-semibold text-ink lg:mt-0">Sign in to TapIn</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{TAGLINE}</p>
          </div>
          <div className="surface rounded-2xl p-6 sm:p-7">
            <Suspense fallback={<FormSkeleton />}>
              <LoginFormWithNotice searchParams={searchParams} />
            </Suspense>
          </div>
          <p className="mt-6 text-center text-sm lg:text-left"><Link href="/forgot" className="font-medium text-brand hover:underline">Forgot password?</Link></p>
          <p className="mt-2 text-center text-xs text-muted-foreground lg:text-left">Accounts are created by your school admin. <Link href="/privacy" className="hover:underline">Privacy</Link></p>
        </div>
      </section>
    </main>
  );
}
