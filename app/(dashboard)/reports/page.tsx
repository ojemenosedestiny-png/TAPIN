import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileBarChart } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { attendanceRate, formatRate, parseRange, presetRanges, totals } from "@/lib/reports";
import { loadReport } from "@/lib/report-data";
import { localDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/field";
import { EmptyState } from "@/components/dashboard/page-header";
import { KpiStrip } from "@/components/dashboard/today-blocks";
import { PrintButton } from "./print-button";
import { StaffReport } from "./staff-report";

export const metadata: Metadata = { title: "Reports" };

const SHOW_ROWS = 500;
type Search = { from?: string; to?: string; class?: string; status?: string; who?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("reports");
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("name, timezone").eq("id", user.schoolId).single();
  if (!school) throw new Error("School not found.");

  const today = localDate(new Date(), school.timezone);
  const range = parseRange(sp.from, sp.to, today);
  const classId = sp.class && /^[0-9a-f-]{36}$/i.test(sp.class) ? sp.class : null;
  const onlyAbsent = sp.status === "absent";
  const who = sp.who === "staff" && user.role === "school_admin" ? "staff" : "students";

  const [{ data: classes }, report] = await Promise.all([
    supabase.from("classes").select("id, name").order("name"),
    who === "students" ? loadReport(supabase, { ...range, classId }) : Promise.resolve({ rows: [], students: [] }),
  ]);
  let rows = report.rows;
  if (onlyAbsent) rows = rows.filter((r) => r.absent > 0);
  // Students who most need attention first: lowest attendance, then most absences.
  rows = [...rows].sort((a, b) => (attendanceRate(a) ?? 101) - (attendanceRate(b) ?? 101) || b.absent - a.absent || a.student.full_name.localeCompare(b.student.full_name));
  const t = totals(rows);
  const className = classId ? (classes ?? []).find((c) => c.id === classId)?.name : null;

  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const m = { from: range.from, to: range.to, class: classId ?? undefined, status: onlyAbsent ? "absent" : undefined, who: who === "staff" ? "staff" : undefined, ...patch };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return p.toString();
  };
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const rangeLabel = range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="motion-rise">
          <h1 className="font-heading text-2xl font-semibold text-ink">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">{school.name} · {className ?? (user.role === "teacher" ? "My classes" : "All classes")} · {rangeLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <Button asChild className="motion-press">
            <a href={`/api/reports/export?${qs({})}`} download><Download className="size-4" /> Excel</a>
          </Button>
        </div>
      </div>

      {user.role === "school_admin" && (
        <nav aria-label="Report on" className="mb-4 flex gap-1 border-b border-border print:hidden">
          {(["students", "staff"] as const).map((w) => (
            <Link key={w} href={`/reports?${qs({ who: w === "staff" ? "staff" : undefined, class: undefined, status: undefined })}`} aria-current={who === w ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize", who === w ? "border-brand text-ink" : "border-transparent text-muted-foreground hover:text-ink")}>
              {w}
            </Link>
          ))}
        </nav>
      )}

      {/* Scope row */}
      <div className="mb-6 space-y-3 print:hidden">
        <nav aria-label="Quick ranges" className="flex gap-1.5 overflow-x-auto pb-1">
          {presetRanges(today).map((p) => {
            const active = p.from === range.from && p.to === range.to;
            return (
              <Link key={p.label} href={`/reports?${qs({ from: p.from, to: p.to })}`} aria-current={active ? "page" : undefined}
                className={cn("motion-press shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                  active ? "bg-brand-light text-brand-dark ring-brand/25" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
                {p.label}
              </Link>
            );
          })}
        </nav>
        <form action="/reports" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">From</span>
            <input type="date" name="from" defaultValue={range.from} max={today} className={cn(selectClass, "w-40")} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">To</span>
            <input type="date" name="to" defaultValue={range.to} max={today} className={cn(selectClass, "w-40")} />
          </label>
          {who === "staff" ? <input type="hidden" name="who" value="staff" /> : (<>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Class</span>
            <select name="class" defaultValue={classId ?? ""} className={cn(selectClass, "w-44")}>
              <option value="">{user.role === "teacher" ? "My classes" : "All classes"}</option>
              {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="status" value="absent" defaultChecked={onlyAbsent} className="size-4 accent-[var(--brand)]" /> Only students with absences
          </label>
          </>)}
          <Button type="submit" variant="outline" className="motion-press">Show report</Button>
        </form>
        {range.error && <p className="text-sm text-amber-800" role="status">{range.error}</p>}
      </div>

      {who === "staff" ? (
        <StaffReport from={range.from} to={range.to} />
      ) : report.rows.length === 0 ? (
        <EmptyState icon={<FileBarChart className="size-7" aria-hidden />} title="Nothing to report for these dates"
          body="There were no school days with active students in this range. Weekends and holidays are left out." />
      ) : (
        <>
          <KpiStrip items={[
            { label: "Attendance", value: Math.round(t.rate ?? 0), suffix: "%", lead: true, caption: `Of ${(t.school_days - t.excused).toLocaleString()} student-days, on time or late` },
            { label: "Late arrivals", value: t.late, tone: "warn", caption: `${rows.filter((r) => r.late > 0).length} students` },
            { label: "Absences", value: t.absent, tone: "negative", caption: `${rows.filter((r) => r.absent > 0).length} students` },
            { label: "Excused", value: t.excused, caption: "Not counted against attendance" },
          ]} />

          <section className="motion-rise mt-6 overflow-x-auto rounded-xl border border-border bg-card" style={{ "--d": "150ms" } as React.CSSProperties} aria-labelledby="by-student">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-4">
              <h2 id="by-student" className="text-base font-semibold text-ink">By student</h2>
              <p className="text-xs text-muted-foreground">{rows.length.toLocaleString()} student{rows.length === 1 ? "" : "s"} · lowest attendance first</p>
            </div>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-2 font-normal">Student</th>
                  <th scope="col" className="px-3 py-2 font-normal">Class</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Days</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Present</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Late</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Absent</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Excused</th>
                  <th scope="col" className="w-48 px-5 py-2 text-right font-normal">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOW_ROWS).map((r, i) => {
                  const rate = attendanceRate(r);
                  return (
                    <tr key={r.student_id} className="motion-rise border-t border-border" style={{ "--d": `${160 + Math.min(i, 24) * 20}ms` } as React.CSSProperties}>
                      <td className="px-5 py-2.5">
                        <Link href={`/students?student=${r.student_id}`} className="font-medium text-ink hover:text-brand">{r.student.full_name}</Link>
                        <span className="block text-xs tabular-nums text-muted-foreground">{r.student.admission_no}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.student.class_name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.school_days}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.present}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.late ? "text-amber-800" : "text-muted-foreground")}>{r.late}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.absent ? "font-medium text-red-700" : "text-muted-foreground")}>{r.absent}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.excused}</td>
                      <td className="px-5 py-2.5">
                        <span className="flex items-center justify-end gap-3">
                          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-brand-light sm:block" aria-hidden>
                            <span className={cn("motion-grow-x block h-full rounded-full", rate !== null && rate < 80 ? "bg-red-400" : rate !== null && rate < 90 ? "bg-warn" : "bg-brand")}
                              style={{ width: `${rate ?? 0}%`, "--d": `${300 + Math.min(i, 24) * 20}ms` } as React.CSSProperties} />
                          </span>
                          <span className={cn("w-14 text-right tabular-nums", rate !== null && rate < 80 ? "font-medium text-red-700" : "text-ink")}>{formatRate(rate)}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > SHOW_ROWS && (
              <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">Showing the {SHOW_ROWS} students with the lowest attendance. The Excel export has all {rows.length.toLocaleString()}.</p>
            )}
          </section>
          <p className="mt-3 text-xs text-muted-foreground">Attendance = days present or late ÷ school days, not counting excused days. Weekends and holidays are left out. Below 90% is amber, below 80% red.</p>
        </>
      )}
    </>
  );
}
