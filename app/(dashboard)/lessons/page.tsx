import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Download, Presentation, Settings2 } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { parseRange } from "@/lib/reports";
import { friendlyTime, localDate } from "@/lib/time";
import { FLAG_LABEL, formatMinutes, minutesBetween, type LessonFlag } from "@/lib/lessons";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/field";
import { PrintButton } from "../reports/print-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lessons" };

type Search = { from?: string; to?: string; teacher?: string; class?: string; subject?: string; flagged?: string };
type LessonRow = {
  id: string; staff_id: string; class_id: string | null; subject_id: string | null; class_name: string; subject_name: string; date: string;
  started_at: string; ended_at: string | null; duration_minutes: number | null; status: string; flags: LessonFlag[];
};

const uuid = /^[0-9a-f-]{36}$/i;

export default async function LessonsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("lessons");
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("timezone").eq("id", user.schoolId).single();
  const tz = school?.timezone ?? "Africa/Lagos";
  const now = new Date();
  const today = localDate(now, tz);
  const range = parseRange(sp.from, sp.to, today);
  const week = parseRange(undefined, undefined, today);

  let log = supabase.from("lessons")
    .select("id, staff_id, class_id, subject_id, class_name, subject_name, date, started_at, ended_at, duration_minutes, status, flags")
    .gte("date", range.from).lte("date", range.to).order("started_at", { ascending: false }).limit(300);
  if (sp.teacher && uuid.test(sp.teacher)) log = log.eq("staff_id", sp.teacher);
  if (sp.class && uuid.test(sp.class)) log = log.eq("class_id", sp.class);
  if (sp.subject && uuid.test(sp.subject)) log = log.eq("subject_id", sp.subject);
  if (sp.flagged === "1") log = log.neq("flags", "{}");

  const [{ data: settings }, { data: staff }, { data: att }, { data: open }, { data: weekRows }, { data: rows }, { data: classes }, { data: subjects }] = await Promise.all([
    supabase.from("lesson_settings").select("enabled").maybeSingle(),
    supabase.from("staff").select("id, name, photo_url").eq("status", "active").order("name"),
    supabase.from("attendance").select("holder_id, sign_in_at, sign_out_at, auto_signed_out").eq("holder_type", "staff").eq("date", today),
    supabase.from("lessons").select("id, staff_id, class_name, subject_name, started_at").eq("status", "open").eq("date", today),
    supabase.from("lessons").select("staff_id, duration_minutes, flags").gte("date", week.from).lte("date", week.to).neq("status", "open"),
    log,
    supabase.from("classes").select("id, name").order("name"),
    supabase.from("subjects").select("id, name").order("name"),
  ]);

  const staffList = staff ?? [];
  const photos = await signPhotos(supabase, staffList.map((s) => s.photo_url));
  const nameOf = new Map(staffList.map((s) => [s.id, s.name]));
  const photoOf = new Map(staffList.map((s) => [s.id, s.photo_url ? photos.get(s.photo_url) ?? null : null]));
  const attOf = new Map((att ?? []).map((a) => [a.holder_id as string, a]));
  const openOf = new Map((open ?? []).map((l) => [l.staff_id as string, l]));

  const teaching = staffList.filter((s) => openOf.has(s.id));
  const inSchool = staffList.filter((s) => !openOf.has(s.id) && attOf.get(s.id)?.sign_in_at && !attOf.get(s.id)?.sign_out_at);
  const left = staffList.filter((s) => attOf.get(s.id)?.sign_out_at);
  const notIn = staffList.filter((s) => !attOf.get(s.id)?.sign_in_at);

  const weekly = new Map<string, { lessons: number; minutes: number; flagged: number }>();
  for (const r of (weekRows ?? []) as { staff_id: string; duration_minutes: number | null; flags: string[] }[]) {
    const w = weekly.get(r.staff_id) ?? { lessons: 0, minutes: 0, flagged: 0 };
    w.lessons++;
    w.minutes += r.duration_minutes ?? 0;
    if (r.flags.length) w.flagged++;
    weekly.set(r.staff_id, w);
  }
  const weeklyRows = staffList.map((s) => ({ id: s.id, name: s.name, ...(weekly.get(s.id) ?? { lessons: 0, minutes: 0, flagged: 0 }) }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const lessons = (rows ?? []) as LessonRow[];
  const exportQs = new URLSearchParams(Object.entries({ ...sp, from: range.from, to: range.to }).filter(([, v]) => typeof v === "string" && v) as [string, string][]);

  if (!settings?.enabled && lessons.length === 0) {
    return (
      <>
        <PageHeader title="Lessons" description="See who is teaching, for how long, and which lessons need a look." />
        <EmptyState icon={<Presentation className="size-7" aria-hidden />} title="Lesson check is off"
          body="Turn it on, add your subjects and who teaches what. Teachers then start and end lessons by tapping their card at the kiosk."
          action={<Button asChild><Link href="/lessons/setup"><Settings2 className="size-4" aria-hidden /> Set up lessons</Link></Button>} />
      </>
    );
  }

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Lessons" description="Live from the kiosk: who is teaching, for how long, and which lessons need a look.">
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button asChild variant="outline"><Link href="/lessons/monthly"><CalendarRange className="size-4" aria-hidden /> Monthly report</Link></Button>
          <Button asChild variant="outline"><Link href="/lessons/setup"><Settings2 className="size-4" aria-hidden /> Setup</Link></Button>
          <Button asChild variant="outline"><a href={`/api/reports/lessons?${exportQs}`}><Download className="size-4" aria-hidden /> CSV</a></Button>
          <PrintButton />
        </div>
      </PageHeader>

      {/* Right now */}
      <section aria-labelledby="now-h" className="print:hidden">
        <h2 id="now-h" className="sr-only">Right now</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Teaching now", n: teaching.length, tone: "text-brand" },
            { label: "In school", n: inSchool.length, tone: "text-ink" },
            { label: "Left", n: left.length, tone: "text-ink" },
            { label: "Not in yet", n: notIn.length, tone: "text-muted-foreground" },
          ].map((k) => (
            <div key={k.label} className="surface rounded-2xl px-4 py-4">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className={cn("mt-1 font-heading text-3xl font-semibold tabular-nums", k.tone)}>{k.n}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="surface rounded-2xl p-5">
            <h3 className="font-semibold text-ink">In a lesson now</h3>
            {teaching.length ? (
              <ul className="mt-3 divide-y divide-border">
                {teaching.map((s) => {
                  const l = openOf.get(s.id)!;
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <PersonAvatar name={s.name} src={photoOf.get(s.id) ?? null} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{s.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{l.class_name} · {l.subject_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums text-ink">{formatMinutes(minutesBetween(new Date(l.started_at), now))}</p>
                        <p className="text-xs text-muted-foreground">since {friendlyTime(l.started_at, tz)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-3 text-sm text-muted-foreground">No lesson running right now.</p>}
          </div>
          <div className="surface rounded-2xl p-5">
            <h3 className="font-semibold text-ink">Staff today</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {[...inSchool.map((s) => ({ s, what: "In school", tone: "bg-success/15 text-green-800" })),
                ...left.map((s) => ({ s, what: attOf.get(s.id)?.auto_signed_out ? "Didn't sign out" : `Left ${friendlyTime(attOf.get(s.id)!.sign_out_at!, tz)}`, tone: attOf.get(s.id)?.auto_signed_out ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground" })),
                ...notIn.map((s) => ({ s, what: "Not in yet", tone: "bg-muted text-muted-foreground" }))].map(({ s, what, tone }) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">{s.name}</span>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", tone)}>{what}</span>
                </li>
              ))}
              {staffList.length === 0 && <li className="text-muted-foreground">No active staff yet.</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* This week */}
      <section aria-labelledby="week-h" className="mt-8 print:hidden">
        <h2 id="week-h" className="text-lg font-semibold text-ink">This week</h2>
        <div className="surface mt-3 overflow-x-auto rounded-xl">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Teacher</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Lessons</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Teaching time</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Average</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Flagged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeklyRows.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2.5 font-medium text-ink">{w.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{w.lessons}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{w.minutes ? formatMinutes(w.minutes) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{w.lessons ? formatMinutes(Math.round(w.minutes / w.lessons)) : "—"}</td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums", w.flagged ? "font-semibold text-amber-800" : "")}>{w.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lesson log */}
      <section aria-labelledby="log-h" className="mt-8">
        <h2 id="log-h" className="text-lg font-semibold text-ink">Lesson log <span className="hidden text-sm font-normal text-muted-foreground print:inline">· {range.from} to {range.to}</span></h2>
        <form className="surface mt-3 grid grid-cols-2 gap-3 rounded-xl p-4 sm:grid-cols-3 lg:grid-cols-6 print:hidden" method="get">
          <label className="text-sm"><span className="text-muted-foreground">From</span>
            <input type="date" name="from" defaultValue={range.from} className={cn(selectClass, "mt-1")} /></label>
          <label className="text-sm"><span className="text-muted-foreground">To</span>
            <input type="date" name="to" defaultValue={range.to} className={cn(selectClass, "mt-1")} /></label>
          <label className="text-sm"><span className="text-muted-foreground">Teacher</span>
            <select name="teacher" defaultValue={sp.teacher ?? ""} className={cn(selectClass, "mt-1")}>
              <option value="">All</option>{staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Class</span>
            <select name="class" defaultValue={sp.class ?? ""} className={cn(selectClass, "mt-1")}>
              <option value="">All</option>{(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Subject</span>
            <select name="subject" defaultValue={sp.subject ?? ""} className={cn(selectClass, "mt-1")}>
              <option value="">All</option>{(subjects ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="flagged" value="1" defaultChecked={sp.flagged === "1"} className="size-4 accent-[var(--brand)]" /> Flagged only</label>
            <Button type="submit" size="sm">Show</Button>
          </div>
        </form>
        {range.error && <p className="mt-2 text-sm text-amber-800">{range.error}</p>}

        {lessons.length ? (
          <div className="surface mt-3 overflow-x-auto rounded-xl">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  <th scope="col" className="px-4 py-3 font-medium">Teacher</th>
                  <th scope="col" className="px-4 py-3 font-medium">Class · Subject</th>
                  <th scope="col" className="px-4 py-3 font-medium">Time</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Length</th>
                  <th scope="col" className="px-4 py-3 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lessons.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{l.date}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{nameOf.get(l.staff_id) ?? "Former staff"}</td>
                    <td className="px-4 py-2.5">{l.class_name} · {l.subject_name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{friendlyTime(l.started_at, tz)}{l.ended_at ? ` – ${friendlyTime(l.ended_at, tz)}` : " – now"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{l.duration_minutes === null ? "Running" : formatMinutes(l.duration_minutes)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {l.flags.map((f) => <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{FLAG_LABEL[f] ?? f}</span>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lessons.length === 300 && <p className="px-4 py-3 text-xs text-muted-foreground">Showing the latest 300. Narrow the dates or download the CSV for everything.</p>}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No lessons match these filters.</p>
        )}
      </section>
    </>
  );
}
