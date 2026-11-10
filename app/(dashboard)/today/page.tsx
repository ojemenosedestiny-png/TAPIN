import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, CheckCircle2, Circle, FileBarChart } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { fetchAllPages } from "@/lib/reports";
import { bucketArrivals } from "@/lib/today";
import { friendlyTime, hhmm, localDate, localTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { AttendancePill } from "@/components/dashboard/status-pill";
import {
  ArrivalsChart, BlockHeading, ClassBars, GateFeed, KpiStrip, LiveDot, type ClassRow, type FeedItem, type Kpi,
} from "@/components/dashboard/today-blocks";

export const metadata: Metadata = { title: "Today" };

type ClassCounts = { class_id: string | null; total: number; present: number; late: number; absent: number; excused: number; pending: number };

export default async function TodayPage() {
  const user = await requireSchoolArea("today");
  const isAdmin = user.role === "school_admin";
  const supabase = await createClient();

  const { data: school } = await supabase
    .from("schools").select("name, timezone, resumption_time, absence_cutoff_time, closing_time").eq("id", user.schoolId).single();
  if (!school) throw new Error("School not found.");
  const tz = school.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const afterCutoff = localTime(now, tz) >= hhmm(school.absence_cutoff_time);

  const [{ data: byClass }, { data: classes }, arrivals, missing, staffIn, staffTotal, unread, setup] = await Promise.all([
    supabase.rpc("today_by_class"),
    supabase.from("classes").select("id, name").order("name"),
    fetchAllPages<{ sign_in_at: string }>((f, t) =>
      supabase.from("attendance").select("sign_in_at").eq("holder_type", "student").eq("date", today).not("sign_in_at", "is", null).range(f, t)),
    supabase.rpc("attendance_days", { p_from: today, p_to: today }).in("status", ["absent", "pending"]).limit(200),
    isAdmin ? supabase.from("attendance").select("id", { count: "exact", head: true }).eq("holder_type", "staff").eq("date", today) : Promise.resolve({ count: 0 }),
    isAdmin ? supabase.from("staff").select("id", { count: "exact", head: true }).eq("status", "active") : Promise.resolve({ count: 0 }),
    isAdmin ? supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null) : Promise.resolve({ count: 0 }),
    isAdmin
      ? Promise.all([
          supabase.from("classes").select("id", { count: "exact", head: true }),
          supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("cards").select("id", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("devices").select("id", { count: "exact", head: true }).is("revoked_at", null),
        ])
      : Promise.resolve(null),
  ]);

  const counts = (byClass ?? []) as ClassCounts[];
  const sum = (k: keyof Omit<ClassCounts, "class_id">) => counts.reduce((a, c) => a + c[k], 0);
  const total = sum("total");
  const present = sum("present");
  const late = sum("late");
  const absent = sum("absent");
  const excused = sum("excused");
  const pending = sum("pending");
  const inSchool = present + late;

  const dateLine = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  const title = (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="motion-rise">
        <h1 className="font-heading text-2xl font-semibold text-ink">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">{dateLine} · {school.name}</p>
      </div>
      <div className="flex items-center gap-3">
        <LiveDot label="Live · updates every 20 s" />
        <Button asChild variant="outline" className="motion-press">
          <Link href={`/reports?from=${today}&to=${today}`}><FileBarChart className="size-4" /> Today&apos;s report</Link>
        </Button>
      </div>
    </div>
  );

  // First run: nothing to show yet → a setup checklist at its true percentage.
  if (isAdmin && total === 0 && setup) {
    const [c, s, k, d] = setup.map((r) => r.count ?? 0);
    const steps = [
      { done: c > 0, label: "Create your classes", href: "/classes" },
      { done: s > 0, label: "Import students and guardians", href: "/students/import" },
      { done: k > 0, label: "Enrol ID cards", href: "/enroll" },
      { done: d > 0, label: "Register the gate kiosk", href: "/devices" },
    ];
    const pct = Math.round((steps.filter((x) => x.done).length / steps.length) * 100);
    return (
      <>
        {title}
        <section className="motion-rise max-w-2xl rounded-xl border border-border bg-card p-6" aria-labelledby="setup">
          <h2 id="setup" className="text-lg font-semibold text-ink">Get {school.name} ready for the gate</h2>
          <p className="mt-1 text-sm text-muted-foreground">Attendance shows here as soon as students tap in.</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-light" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
            <div className="motion-grow-x h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{pct}% done</p>
          <ol className="mt-4 divide-y divide-border">
            {steps.map((st, i) => (
              <li key={st.label} className="motion-rise" style={{ "--d": `${100 + i * 70}ms` } as React.CSSProperties}>
                <Link href={st.href} className="motion-press group flex items-center gap-3 py-3">
                  {st.done ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <Circle className="size-5 text-slate-300" aria-hidden />}
                  <span className={st.done ? "text-muted-foreground line-through" : "font-medium text-ink"}>{st.label}</span>
                  {!st.done && <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </>
    );
  }

  // --- Live gate feed -------------------------------------------------------
  let feed: FeedItem[] = [];
  if (isAdmin) {
    const { data: taps } = await supabase.from("tap_events").select("id, holder_type, holder_id, result, late, tapped_at, uid").order("tapped_at", { ascending: false }).limit(8);
    const todays = (taps ?? []).filter((t) => localDate(t.tapped_at, tz) === today);
    const studentIds = todays.filter((t) => t.holder_type === "student").map((t) => t.holder_id);
    const staffIds = todays.filter((t) => t.holder_type === "staff").map((t) => t.holder_id);
    const [{ data: st }, { data: sf }] = await Promise.all([
      studentIds.length ? supabase.from("student_overview").select("id, full_name, class_name, photo_url").in("id", studentIds) : Promise.resolve({ data: [] }),
      staffIds.length ? supabase.from("staff").select("id, name, photo_url").in("id", staffIds) : Promise.resolve({ data: [] }),
    ]);
    const people = new Map<string, { name: string; sub: string; photo: string | null }>();
    for (const s of (st ?? []) as { id: string; full_name: string; class_name: string | null; photo_url: string | null }[]) people.set(s.id, { name: s.full_name, sub: s.class_name ?? "Student", photo: s.photo_url });
    for (const s of (sf ?? []) as { id: string; name: string; photo_url: string | null }[]) people.set(s.id, { name: s.name, sub: "Staff", photo: s.photo_url });
    const photos = await signPhotos(supabase, [...people.values()].map((p) => p.photo));
    feed = todays.map((t) => {
      const p = t.holder_id ? people.get(t.holder_id) : undefined;
      return {
        id: String(t.id), name: p?.name ?? `Card ••••${t.uid.slice(-4)}`, sub: p?.sub ?? "Not linked to anyone",
        photoUrl: p?.photo ? photos.get(p.photo) ?? null : null, time: friendlyTime(t.tapped_at, tz),
        result: t.result, late: t.late, fresh: now.getTime() - new Date(t.tapped_at).getTime() < 120_000,
      };
    });
  } else {
    const { data: recent } = await supabase.from("attendance").select("id, holder_id, sign_in_at, sign_out_at").eq("holder_type", "student").eq("date", today).order("sign_in_at", { ascending: false }).limit(8);
    const ids = (recent ?? []).map((r) => r.holder_id);
    const { data: st } = ids.length ? await supabase.from("student_overview").select("id, full_name, class_name, photo_url").in("id", ids) : { data: [] };
    const byId = new Map(((st ?? []) as { id: string; full_name: string; class_name: string | null; photo_url: string | null }[]).map((s) => [s.id, s]));
    const photos = await signPhotos(supabase, [...byId.values()].map((s) => s.photo_url));
    feed = (recent ?? []).map((r) => {
      const s = byId.get(r.holder_id);
      const at = r.sign_out_at ?? r.sign_in_at!;
      return {
        id: r.id, name: s?.full_name ?? "Student", sub: s?.class_name ?? "", photoUrl: s?.photo_url ? photos.get(s.photo_url) ?? null : null,
        time: friendlyTime(at, tz), result: r.sign_out_at ? "signed_out" : "signed_in",
        late: hhmm(localTime(r.sign_in_at!, tz)) > hhmm(school.resumption_time), fresh: now.getTime() - new Date(at).getTime() < 120_000,
      };
    });
  }

  // --- Who is missing -------------------------------------------------------
  const missingRows = (missing.data ?? []) as { student_id: string; status: "absent" | "pending" }[];
  const missingIds = missingRows.slice(0, 6).map((m) => m.student_id);
  const { data: missingPeople } = missingIds.length
    ? await supabase.from("student_overview").select("id, full_name, class_name, photo_url, guardian_phone").in("id", missingIds)
    : { data: [] };
  const missingPhotos = await signPhotos(supabase, ((missingPeople ?? []) as { photo_url: string | null }[]).map((p) => p.photo_url));
  const missingById = new Map(((missingPeople ?? []) as { id: string; full_name: string; class_name: string | null; photo_url: string | null }[]).map((p) => [p.id, p]));

  // --- Absence watch: absent 3+ days or late 5+ times in the last 30 days ----
  const { data: watchRows } = await supabase.rpc("attendance_watch").limit(5);
  const watch = (watchRows ?? []) as { student_id: string; absent: number; late: number; school_days: number }[];
  const { data: watchPeople } = watch.length
    ? await supabase.from("student_overview").select("id, full_name, class_name").in("id", watch.map((w) => w.student_id))
    : { data: [] };
  const watchById = new Map(((watchPeople ?? []) as { id: string; full_name: string; class_name: string | null }[]).map((p) => [p.id, p]));
  const monthAgo = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 29); return d.toISOString().slice(0, 10); })();

  const classNames = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const classRows: ClassRow[] = counts
    .filter((c) => c.class_id)
    .map((c) => ({ id: c.class_id!, name: classNames.get(c.class_id!) ?? "—", total: c.total, present: c.present, late: c.late, absent: c.absent, excused: c.excused, pending: c.pending }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  const kpis: Kpi[] = [
    { label: "In school", value: inSchool, of: total, lead: true, caption: total ? `${Math.round((inSchool / total) * 100)}% of students, on time or late` : "No students yet" },
    { label: "Late", value: late, tone: "warn", caption: `Arrived after ${hhmm(school.resumption_time)}` },
    afterCutoff
      ? { label: "Absent", value: absent, tone: "negative", caption: excused ? `${excused} more excused` : "Not signed in, not excused" }
      : { label: "Not in yet", value: pending, caption: `Absence alerts go at ${hhmm(school.absence_cutoff_time)}` },
  ];
  if (isAdmin) kpis.push({ label: "Staff in", value: staffIn.count ?? 0, of: staffTotal.count ?? 0, caption: "Signed in at the gate" });

  const buckets = bucketArrivals(arrivals.map((a) => localTime(a.sign_in_at, tz)), hhmm(school.resumption_time));

  return (
    <>
      <AutoRefresh seconds={20} />
      {title}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_384px]">
        {/* Main column */}
        <div className="space-y-6">
          <KpiStrip items={kpis} />

          <section className="motion-rise rounded-xl border border-border bg-card p-5" style={{ "--d": "150ms" } as React.CSSProperties} aria-labelledby="gate">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="gate" className="text-base font-semibold text-ink">The morning gate</h2>
              <p className="text-xs text-muted-foreground">Arrivals by time · students</p>
            </div>
            <ArrivalsChart buckets={buckets} resumption={hhmm(school.resumption_time)} total={arrivals.length} />
          </section>

          <section className="motion-rise rounded-xl border border-border bg-card p-5" style={{ "--d": "220ms" } as React.CSSProperties} aria-labelledby="classes">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="classes" className="text-base font-semibold text-ink">{isAdmin ? "By class" : "My classes"}</h2>
              <p className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" />On time</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warn" />Late</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-400" />Absent</span>
              </p>
            </div>
            {classRows.length ? <ClassBars rows={classRows} /> : <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{isAdmin ? "No classes yet." : "You aren't class teacher of any class yet. Ask your school admin."}</p>}
          </section>
        </div>

        {/* Rail */}
        <div className="space-y-6">
          <section aria-labelledby="feed" className="motion-rise" style={{ "--d": "120ms" } as React.CSSProperties}>
            <BlockHeading title="At the gate" right={<LiveDot />} />
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {feed.length ? <GateFeed items={feed} /> : (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No taps yet today. They appear here the moment a card touches the kiosk.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="missing" className="motion-rise" style={{ "--d": "200ms" } as React.CSSProperties}>
            <BlockHeading title={afterCutoff ? `Absent (${absent})` : `Not in yet (${pending + absent})`} />
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {missingRows.length === 0 ? (
                <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-success" aria-hidden /> Everyone is accounted for.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {missingRows.slice(0, 6).map((m) => {
                      const p = missingById.get(m.student_id);
                      if (!p) return null;
                      return (
                        <li key={m.student_id} className="flex items-center gap-3 px-4 py-2.5">
                          <PersonAvatar name={p.full_name} src={p.photo_url ? missingPhotos.get(p.photo_url) : null} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{p.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{p.class_name ?? "No class"}</p>
                          </div>
                          <AttendancePill status={m.status} />
                          <Link href={`/students?student=${m.student_id}`} className="text-xs font-medium text-brand hover:underline">Excuse</Link>
                        </li>
                      );
                    })}
                  </ul>
                  {missingRows.length > 6 && (
                    <Link href={`/reports?from=${today}&to=${today}&status=absent`} className="block border-t border-border px-4 py-2.5 text-center text-sm font-medium text-ink hover:bg-muted/50">
                      View all {missingRows.length >= 200 ? "200+" : missingRows.length}
                    </Link>
                  )}
                </>
              )}
            </div>
          </section>

          {watch.length > 0 && (
            <section aria-labelledby="watch" className="motion-rise" style={{ "--d": "240ms" } as React.CSSProperties}>
              <BlockHeading title="Needs a closer look" right={<Link href={`/reports?from=${monthAgo}&to=${today}`} className="text-xs font-medium text-brand hover:underline">Last 30 days</Link>} />
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {watch.map((w) => {
                  const p = watchById.get(w.student_id);
                  if (!p) return null;
                  return (
                    <li key={w.student_id}>
                      <Link href={`/students?student=${w.student_id}`} className="motion-press flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{p.full_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{p.class_name ?? "No class"}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs tabular-nums">
                          {w.absent >= 3 && <span className="block font-medium text-red-700">{w.absent} days absent</span>}
                          {w.late >= 5 && <span className="block text-amber-800">{w.late} times late</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {isAdmin && (unread.count ?? 0) > 0 && (
            <Link href="/alerts" className="motion-rise motion-press flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" style={{ "--d": "260ms" } as React.CSSProperties}>
              <BellRing className="size-4 shrink-0" aria-hidden />
              <span className="flex-1"><strong className="font-semibold">{unread.count}</strong> alert{unread.count === 1 ? "" : "s"} need attention: unknown cards, offline kiosks or failed SMS.</span>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
