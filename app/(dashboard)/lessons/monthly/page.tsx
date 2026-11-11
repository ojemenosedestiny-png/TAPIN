import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate } from "@/lib/time";
import { monthOf, parseMonth } from "@/lib/teacher-report";
import { loadMonthlyReport } from "@/lib/teacher-report-data";
import { PageHeader } from "@/components/dashboard/page-header";
import { TeacherMonthView } from "@/components/reports/teacher-month-view";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/field";
import { PrintButton } from "../../reports/print-button";
import { ShareReport } from "./share";

export const metadata: Metadata = { title: "Monthly teacher report" };

export default async function MonthlyTeacherReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("lessons");
  // Service role, scoped to the signed-in admin's own school.
  const db = createAdminClient();
  const [{ data: school }, { data: settings }] = await Promise.all([
    db.from("schools").select("timezone").eq("id", user.schoolId).single(),
    db.from("lesson_settings").select("director_phone").eq("school_id", user.schoolId).maybeSingle(),
  ]);
  const thisMonth = monthOf(localDate(new Date(), school?.timezone ?? "Africa/Lagos"));
  const month = parseMonth(sp.month, thisMonth);
  const report = await loadMonthlyReport(db, user.schoolId, month);

  return (
    <>
      <PageHeader title="Monthly teacher report" description="Attendance, punctuality and teaching time for every teacher, compared with last month.">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button asChild variant="outline"><Link href="/lessons"><ArrowLeft className="size-4" aria-hidden /> Lessons</Link></Button>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="month" className="sr-only">Month</label>
            <input id="month" type="month" name="month" defaultValue={month} max={thisMonth} className={selectClass} />
            <Button type="submit" variant="outline">Show</Button>
          </form>
          <PrintButton />
        </div>
      </PageHeader>
      <div className="mb-6"><ShareReport month={month} hasDirector={!!settings?.director_phone} /></div>
      {report ? <TeacherMonthView report={report} /> : <p className="text-muted-foreground">School not found.</p>}
    </>
  );
}
