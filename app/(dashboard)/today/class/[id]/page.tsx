import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { attendanceRate, formatRate, type DayStatus } from "@/lib/reports";
import { friendlyTime, hhmm, localDate, localTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { AttendancePill } from "@/components/dashboard/status-pill";
import { KpiStrip, LiveDot, type Kpi } from "@/components/dashboard/today-blocks";
import { ExcuseButton } from "./excuse-button";
import { ReleaseButton } from "@/components/enroll/release-button";

export const metadata: Metadata = { title: "Class attendance" };

const DOT: Record<DayStatus, string> = {
  present: "bg-brand", late: "bg-warn", absent: "bg-red-400", excused: "bg-slate-400", pending: "bg-transparent ring-1 ring-inset ring-slate-300",
};
const WORD: Record<DayStatus, string> = { present: "Present", late: "Late", absent: "Absent", excused: "Excused", pending: "Not in yet" };

type Day = { student_id: string; date: string; status: DayStatus; sign_in_at: string | null; sign_out_at: string | null };

export default async function ClassTodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSchoolArea("today");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: cls }, { data: school }] = await Promise.all([
    supabase.from("classes").select("id, name, class_teacher_id").eq("id", id).maybeSingle(),
    supabase.from("schools").select("timezone, resumption_time, absence_cutoff_time").eq("id", user.schoolId).single(),
  ]);
  if (!cls || !school) notFound();
  const tz = school.timezone;
  const today = localDate(new Date(), tz);
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const week = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - dow + i);
    return d.toISOString().slice(0, 10);
  });

  const [{ data: days, error }, { data: students }, { data: teacher }, { data: releases }] = await Promise.all([
    supabase.rpc("attendance_days", { p_from: week[0], p_to: today, p_class: id }),
    supabase.from("student_overview").select("id, full_name, admission_no, photo_url").eq("class_id", id).eq("status", "active").order("last_name").order("first_name"),
    cls.class_teacher_id ? supabase.from("users").select("name").eq("id", cls.class_teacher_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("early_releases").select("holder_id, reason, used_at").eq("holder_type", "student").eq("date", today),
  ]);
  const releaseFor = new Map((releases ?? []).map((r) => [r.holder_id, r]));
  if (error) throw new Error("Could not load attendance.");

  const byStudent = new Map<string, Map<string, Day>>();
  for (const d of (days ?? []) as Day[]) {
    if (!byStudent.has(d.student_id)) byStudent.set(d.student_id, new Map());
    byStudent.get(d.student_id)!.set(d.date, d);
  }
  const photos = await signPhotos(supabase, (students ?? []).map((s) => s.photo_url));
  const rows = (students ?? []).map((s) => ({ ...s, today: byStudent.get(s.id)?.get(today) ?? null, week: byStudent.get(s.id) ?? new Map<string, Day>() }));
  // Who needs attention first: absent, then not in yet, late, present, excused.
  const order: Record<DayStatus, number> = { absent: 0, pending: 1, late: 2, present: 3, excused: 4 };
  rows.sort((a, b) => (order[a.today?.status ?? "present"] - order[b.today?.status ?? "present"]) || a.full_name.localeCompare(b.full_name));

  const count = (st: DayStatus) => rows.filter((r) => r.today?.status === st).length;
  const afterCutoff = localTime(new Date(), tz) >= hhmm(school.absence_cutoff_time);
  const weekTotals = rows.reduce(
    (a, r) => {
      for (const d of r.week.values()) {
        if (d.status === "pending") continue;
        a.school_days++;
        if (d.status === "present") a.present++;
        if (d.status === "late") a.late++;
        if (d.status === "excused") a.excused++;
      }
      return a;
    },
    { school_days: 0, present: 0, late: 0, excused: 0 },
  );

  const kpis: Kpi[] = [
    { label: "In class today", value: count("present") + count("late"), of: rows.length, lead: true, caption: `${count("late")} of them late` },
    afterCutoff
      ? { label: "Absent", value: count("absent"), tone: "negative", caption: `${count("excused")} excused` }
      : { label: "Not in yet", value: count("pending"), caption: `Absence alerts at ${hhmm(school.absence_cutoff_time)}` },
    { label: "This week", value: Math.round(attendanceRate(weekTotals) ?? 0), suffix: "%", caption: weekTotals.school_days ? `Attendance over ${weekTotals.school_days} student-days` : "No school days yet" },
  ];
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" });

  return (
    <>
      <AutoRefresh seconds={30} />
      <Link href="/today" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Today</Link>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="motion-rise">
          <h1 className="font-heading text-2xl font-semibold text-ink">{cls.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{teacher?.name ? `Class teacher: ${teacher.name} · ` : ""}{rows.length} students</p>
        </div>
        <LiveDot />
      </div>

      <KpiStrip items={kpis} />

      <section className="motion-rise mt-6 overflow-hidden rounded-xl border border-border bg-card" style={{ "--d": "150ms" } as React.CSSProperties} aria-labelledby="list">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4">
          <h2 id="list" className="text-base font-semibold text-ink">Today and this week</h2>
          <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {(["present", "late", "absent", "excused"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", DOT[s])} />{WORD[s]}</span>
            ))}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No students in this class yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="hidden text-left text-xs text-muted-foreground md:table-header-group">
              <tr>
                <th scope="col" className="w-[38%] px-5 py-2 font-normal">Student</th>
                <th scope="col" className="px-3 py-2 font-normal">Today</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">In</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Out</th>
                <th scope="col" className="px-3 py-2 font-normal">
                  <span className="flex gap-1.5">{week.map((d) => <span key={d} className="w-4 text-center text-[11px]">{dayName(d).slice(0, 1)}</span>)}</span>
                </th>
                <th scope="col" className="px-5 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = r.today?.status;
                return (
                  <tr key={r.id} className="motion-rise grid grid-cols-[1fr_auto] gap-x-3 border-t border-border px-4 py-3 md:table-row md:px-0 md:py-0" style={{ "--d": `${180 + Math.min(i, 20) * 25}ms` } as React.CSSProperties}>
                    <td className="md:px-5 md:py-2.5">
                      <Link href={`/students?student=${r.id}`} className="flex items-center gap-3">
                        <PersonAvatar name={r.full_name} src={r.photo_url ? photos.get(r.photo_url) : null} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink hover:text-brand">{r.full_name}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {r.admission_no}
                            <span className="md:hidden">{r.today?.sign_in_at ? ` · in ${friendlyTime(r.today.sign_in_at, tz)}` : ""}{r.today?.sign_out_at ? ` · out ${friendlyTime(r.today.sign_out_at, tz)}` : ""}</span>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="self-center justify-self-end md:px-3 md:py-2.5">{st ? <AttendancePill status={st} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink md:table-cell">{r.today?.sign_in_at ? friendlyTime(r.today.sign_in_at, tz) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">{r.today?.sign_out_at ? friendlyTime(r.today.sign_out_at, tz) : "—"}</td>
                    <td className="col-span-2 mt-2 md:mt-0 md:px-3 md:py-2.5">
                      <span className="flex items-center gap-1.5" role="img" aria-label={`This week: ${week.map((d) => `${dayName(d)} ${r.week.get(d) ? WORD[r.week.get(d)!.status] : "no school"}`).join(", ")}`}>
                        {week.map((d) => {
                          const w = r.week.get(d);
                          return (
                            <span key={d} className="flex flex-col items-center gap-0.5">
                              <span className={cn("size-4 rounded-[4px]", w ? DOT[w.status] : d > today ? "bg-slate-100" : "bg-slate-200")} title={`${dayName(d)}: ${w ? WORD[w.status] + (w.sign_in_at ? ` at ${friendlyTime(w.sign_in_at, tz)}` : "") : d > today ? "upcoming" : "no school"}`} />
                              <span className="text-[10px] text-muted-foreground md:hidden">{dayName(d).slice(0, 1)}</span>
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td className="col-span-2 mt-2 md:mt-0 md:px-5 md:py-2.5 md:text-right">
                      {(st === "absent" || st === "pending") && <ExcuseButton studentId={r.id} name={r.full_name} date={today} />}
                      {(st === "present" || st === "late") && !r.today?.sign_out_at && (
                        releaseFor.get(r.id) && !releaseFor.get(r.id)!.used_at
                          ? <span className="text-xs text-amber-900">Released · {releaseFor.get(r.id)!.reason}</span>
                          : <ReleaseButton holderType="student" holderId={r.id} name={r.full_name} />
                      )}
                      {r.today?.sign_out_at && releaseFor.get(r.id)?.used_at && <span className="text-xs text-muted-foreground">Left early · {releaseFor.get(r.id)!.reason}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <p className="mt-3 text-xs text-muted-foreground">Week attendance {formatRate(attendanceRate(weekTotals))}. Excused days don&apos;t count against a student.</p>
    </>
  );
}
