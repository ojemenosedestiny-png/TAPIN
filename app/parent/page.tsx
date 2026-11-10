import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "@/lib/photos";
import { attendanceRate, formatRate, type DayStatus } from "@/lib/reports";
import { friendlyTime, localDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/logo";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { AttendancePill } from "@/components/dashboard/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelChoice } from "./channel-choice";
import { parentSignOut } from "./login/actions";

export const metadata: Metadata = { title: "My children" };

type Child = {
  student_id: string; first_name: string; last_name: string; class_name: string | null; school_name: string; timezone: string;
  photo_url: string | null; guardian_id: string; channel: "sms" | "whatsapp";
};
type Day = { date: string; status: DayStatus; sign_in_at: string | null; sign_out_at: string | null; early_release: boolean; excused_reason: string | null };

const DOT: Record<DayStatus, string> = { present: "bg-brand", late: "bg-warn", absent: "bg-red-400", excused: "bg-slate-400", pending: "bg-slate-200" };

async function Portal() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/parent/login");
  const { data: kids } = await supabase.rpc("parent_children");
  const children = (kids ?? []) as Child[];
  if (!children.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-medium text-ink">No children found for this number.</p>
        <p className="mt-1 text-sm text-muted-foreground">Ask your child&apos;s school to check the phone number they have for you.</p>
      </div>
    );
  }

  // One row per child (a parent may be linked twice, e.g. as mother and emergency contact).
  const unique = [...new Map(children.map((c) => [c.student_id, c])).values()];
  const withDays = await Promise.all(unique.map(async (c) => {
    const today = localDate(new Date(), c.timezone);
    const from = new Date(`${today}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    const { data } = await supabase.rpc("parent_attendance", { p_student: c.student_id, p_from: from.toISOString().slice(0, 10), p_to: today });
    return { child: c, today, days: (data ?? []) as Day[] };
  }));

  // Photos: the database already confirmed this is the parent's own child; sign just those, briefly.
  const paths = withDays.map((w) => w.child.photo_url).filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await createAdminClient().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 300) : { data: [] };
  const photo = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl]));

  return (
    <div className="space-y-6">
      {withDays.map(({ child, today, days }, i) => {
        const tz = child.timezone;
        const todayRow = days.find((d) => d.date === today);
        const counted = days.filter((d) => d.status !== "pending");
        const rate = attendanceRate({
          school_days: counted.length, present: counted.filter((d) => d.status === "present").length,
          late: counted.filter((d) => d.status === "late").length, excused: counted.filter((d) => d.status === "excused").length,
        });
        const name = `${child.first_name} ${child.last_name}`;
        return (
          <section key={child.student_id} className="motion-rise rounded-2xl border border-border bg-card p-5 sm:p-6" style={{ "--d": `${i * 80}ms` } as React.CSSProperties} aria-labelledby={`c-${child.student_id}`}>
            <div className="flex items-center gap-4">
              <PersonAvatar name={name} src={child.photo_url ? photo.get(child.photo_url) ?? null : null} size="md" />
              <div className="min-w-0">
                <h2 id={`c-${child.student_id}`} className="truncate text-lg font-semibold text-ink">{name}</h2>
                <p className="truncate text-sm text-muted-foreground">{child.class_name ?? "No class"} · {child.school_name}</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Today</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {todayRow ? <AttendancePill status={todayRow.status} /> : <span className="text-sm text-muted-foreground">No school today</span>}
                {todayRow?.sign_in_at && <span className="text-sm text-ink">In at <strong className="tabular-nums">{friendlyTime(todayRow.sign_in_at, tz)}</strong></span>}
                {todayRow?.sign_out_at && <span className="text-sm text-ink">{todayRow.early_release ? "Left early" : "Out"} at <strong className="tabular-nums">{friendlyTime(todayRow.sign_out_at, tz)}</strong></span>}
                {todayRow?.excused_reason && <span className="text-sm text-muted-foreground">Excused: {todayRow.excused_reason}</span>}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Last 30 days</p>
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-ink">{formatRate(rate)}</p>
                <p className="text-xs text-muted-foreground">{counted.filter((d) => d.status === "absent").length} absent · {counted.filter((d) => d.status === "late").length} late</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent school days</p>
                <div className="mt-2 flex flex-wrap gap-1" role="img" aria-label={`Last ${Math.min(days.length, 20)} school days`}>
                  {days.slice(0, 20).reverse().map((d) => (
                    <span key={d.date} title={`${d.date}: ${d.status}`} className={cn("size-3.5 rounded-[3px]", DOT[d.status])} />
                  ))}
                </div>
              </div>
            </div>

            <ul className="mt-5 divide-y divide-border text-sm">
              {days.filter((d) => d.status !== "pending").slice(0, 7).map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
                  <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                    {d.sign_in_at && <span>{friendlyTime(d.sign_in_at, tz)}{d.sign_out_at ? ` – ${friendlyTime(d.sign_out_at, tz)}` : ""}</span>}
                    <AttendancePill status={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="motion-rise rounded-2xl border border-border bg-card p-5" aria-labelledby="alerts-how">
        <h2 id="alerts-how" className="font-semibold text-ink">How should the school reach you?</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">Arrival, departure, late and absence alerts.</p>
        <ChannelChoice current={unique[0]!.channel} />
      </section>
    </div>
  );
}

export default function ParentPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Wordmark className="text-sm" markClassName="size-8" />
          <form action={parentSignOut}>
            <button type="submit" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-ink"><LogOut className="size-4" aria-hidden /> Sign out</button>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-5 font-heading text-2xl font-semibold text-ink">My children</h1>
        <Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-64 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-2xl" /></div>}>
          <Portal />
        </Suspense>
      </main>
    </div>
  );
}
