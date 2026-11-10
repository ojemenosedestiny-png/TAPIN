import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  await requireSchoolArea("alerts");
  return (
    <>
      <PageHeader title="Alerts" />
      <EmptyState icon={<Bell className="size-7" aria-hidden />} title="SMS alerts are coming next"
        body="Arrival, departure, late and absence messages to guardians, with templates and an SMS balance, arrive in Stage 4." />
    </>
  );
}
