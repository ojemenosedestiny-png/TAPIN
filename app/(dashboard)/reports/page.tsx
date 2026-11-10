import type { Metadata } from "next";
import { FileBarChart } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireSchoolArea("reports");
  return (
    <>
      <PageHeader title="Reports" />
      <EmptyState icon={<FileBarChart className="size-7" aria-hidden />} title="Reports are coming in Stage 5"
        body="Attendance by date range, class or student, with Excel and PDF export." />
    </>
  );
}
