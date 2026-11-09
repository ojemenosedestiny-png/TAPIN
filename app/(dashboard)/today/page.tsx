import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const user = await requireArea("today");
  const today = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" }).format(new Date());

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description={today} />
      <EmptyState
        icon={<CalendarCheck className="size-7" aria-hidden />}
        title="No taps yet"
        body="Attendance appears here once students and cards are set up and the gate kiosk is running."
      />
    </>
  );
}
