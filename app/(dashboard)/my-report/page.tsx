import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate } from "@/lib/time";
import { monthOf, parseMonth } from "@/lib/teacher-report";
import { loadMonthlyReport } from "@/lib/teacher-report-data";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { OwnMonthView } from "@/components/reports/teacher-month-view";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/field";
import { PrintButton } from "../reports/print-button";

export const metadata: Metadata = { title: "My report" };

/** A teacher's own monthly record. Only ever loads the staff profile linked to this login. */
export default async function MyReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("my-report");
  const db = createAdminClient();
  const [{ data: me }, { data: school }] = await Promise.all([
    db.from("users").select("staff_id").eq("id", user.id).maybeSingle(),
    db.from("schools").select("timezone").eq("id", user.schoolId).single(),
  ]);
  const staffId = (me?.staff_id as string | null | undefined) ?? null;
  const thisMonth = monthOf(localDate(new Date(), school?.timezone ?? "Africa/Lagos"));
  const month = parseMonth(sp.month, thisMonth);
  const report = staffId ? await loadMonthlyReport(db, user.schoolId, month, staffId) : null;
  const row = report?.rows[0];

  return (
    <>
      <PageHeader title="My report" description="Your attendance, punctuality and teaching time this month, compared with last month.">
        {row && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <form method="get" className="flex items-center gap-2">
              <label htmlFor="month" className="sr-only">Month</label>
              <input id="month" type="month" name="month" defaultValue={month} max={thisMonth} className={selectClass} />
              <Button type="submit" variant="outline">Show</Button>
            </form>
            <PrintButton />
          </div>
        )}
      </PageHeader>
      {report && row ? <OwnMonthView report={report} row={row} /> : (
        <EmptyState icon={<UserRound className="size-7" aria-hidden />} title="Your login isn't linked yet"
          body="Ask your school admin to link your login to your staff profile (Settings → Team → Edit). Your report then appears here." />
      )}
    </>
  );
}
