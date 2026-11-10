import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/** Reads the session at request time, so it lives inside the Suspense boundary below. */
async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.needsMfa) redirect("/auth/mfa");
  return (
    <div className="min-h-dvh bg-background lg:flex">
      <Sidebar role={user.role} name={user.name} schoolName={user.schoolName} />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-background lg:flex" aria-busy="true" aria-label="Loading">
      <div className="hidden h-dvh w-64 shrink-0 flex-col gap-3 border-r border-border bg-card p-6 lg:flex">
        <Skeleton className="mb-4 h-8 w-28" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
      <div className="h-14 border-b border-border bg-card lg:hidden" />
      <div className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-40" />
        <Skeleton className="mt-8 h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
