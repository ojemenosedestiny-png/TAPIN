import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { attendanceRate, formatRate } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/dashboard/page-header";
import { KpiStrip } from "@/components/dashboard/today-blocks";

export type StaffRow = {
  staff_id: string; school_days: number; present: number; late: number; absent: number;
  early_leaves: number; avg_arrival: string | null; avg_minutes_on_site: number | null;
};

export function hoursLabel(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}

export function clockLabel(t: string | null): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}

/** Staff tab of Reports (school admins only — teachers can't see staff attendance). */
export async function StaffReport({ from, to }: { from: string; to: string }) {
  const supabase = await createClient();
  const [{ data, error }, { data: staff }] = await Promise.all([
    supabase.rpc("staff_summary", { p_from: from, p_to: to }),
    supabase.from("staff").select("id, name").eq("status", "active"),
  ]);
  if (error) throw new Error("Could not load the staff report.");
  const name = new Map((staff ?? []).map((s) => [s.id, s.name]));
  const rows = ((data ?? []) as StaffRow[]).filter((r) => name.has(r.staff_id))
    .sort((a, b) => (attendanceRate({ ...a, excused: 0 }) ?? 101) - (attendanceRate({ ...b, excused: 0 }) ?? 101) || b.late - a.late);

  if (!rows.length) {
    return <EmptyState icon={<Users className="size-7" aria-hidden />} title="No staff attendance in these dates"
      body="Add staff and give them cards; their taps at the gate show up here." action={<Link href="/staff" className="text-sm font-medium text-brand hover:underline">Go to staff</Link>} />;
  }
  const t = rows.reduce((a, r) => ({ school_days: a.school_days + r.school_days, present: a.present + r.present, late: a.late + r.late, early: a.early + r.early_leaves }),
    { school_days: 0, present: 0, late: 0, early: 0 });
  const rate = attendanceRate({ school_days: t.school_days, present: t.present - t.late, late: t.late, excused: 0 });

  return (
    <>
      <KpiStrip items={[
        { label: "Staff attendance", value: Math.round(rate ?? 0), suffix: "%", lead: true, caption: `Of ${t.school_days.toLocaleString()} staff-days` },
        { label: "Late arrivals", value: t.late, tone: "warn", caption: `${rows.filter((r) => r.late > 0).length} staff` },
        { label: "Left early", value: t.early, caption: "Released before closing" },
      ]} />
      <section className="motion-rise mt-6 overflow-x-auto surface rounded-xl" aria-labelledby="by-staff">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-4">
          <h2 id="by-staff" className="text-base font-semibold text-ink">By staff member</h2>
          <p className="text-xs text-muted-foreground">{rows.length} staff · lowest attendance first</p>
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-2 font-normal">Name</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Days</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Present</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Late</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Absent</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Usually arrives</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Average on site</th>
              <th scope="col" className="px-5 py-2 text-right font-normal">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rRate = attendanceRate({ school_days: r.school_days, present: r.present - r.late, late: r.late, excused: 0 });
              return (
                <tr key={r.staff_id} className="border-t border-border">
                  <td className="px-5 py-2.5"><Link href={`/staff?person=${r.staff_id}`} className="font-medium text-ink hover:text-brand">{name.get(r.staff_id)}</Link></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.school_days}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.present}</td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", r.late ? "text-amber-800" : "text-muted-foreground")}>{r.late}</td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", r.absent ? "font-medium text-red-700" : "text-muted-foreground")}>{r.absent}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{clockLabel(r.avg_arrival)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{hoursLabel(r.avg_minutes_on_site)}{r.early_leaves ? <span className="block text-xs text-muted-foreground">{r.early_leaves} left early</span> : null}</td>
                  <td className={cn("px-5 py-2.5 text-right tabular-nums", rRate !== null && rRate < 80 ? "font-medium text-red-700" : "text-ink")}>{formatRate(rRate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">Late = arrived after the school&apos;s resumption time. Average on site counts days with both a sign-in and a sign-out.</p>
    </>
  );
}
