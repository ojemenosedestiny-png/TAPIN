import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  idle: "You were signed out after 30 minutes of inactivity.",
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

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-light/60 via-background to-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <h1 className="mt-4 text-2xl font-semibold text-ink">Sign in to TapIn</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every child, safe and accounted for.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Suspense fallback={<FormSkeleton />}>
            <LoginFormWithNotice searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Accounts are created by your school admin.</p>
      </div>
    </main>
  );
}
