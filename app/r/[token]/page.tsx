import type { Metadata } from "next";
import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMonthlyReport, resolveReportLink } from "@/lib/teacher-report-data";
import { TeacherMonthView } from "@/components/reports/teacher-month-view";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Teacher report", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

/** The director's private link to a month's teacher report. No login; the link itself is the key and expires. */
async function Report({ params }: { params: Params }) {
  const { token } = await params;
  const db = createAdminClient();
  const link = await resolveReportLink(db, token);
  const report = link ? await loadMonthlyReport(db, link.schoolId, link.month) : null;
  if (!report) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-heading text-2xl font-semibold text-ink">This link has expired</h1>
        <p className="mt-2 text-muted-foreground">Report links work for 60 days. Ask the school for a new one.</p>
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <TeacherMonthView report={report} />
    </>
  );
}

export default function ReportLinkPage({ params }: { params: Params }) {
  return (
    <main id="main" className="min-h-dvh bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Suspense fallback={<div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>}>
          <Report params={params} />
        </Suspense>
      </div>
    </main>
  );
}
