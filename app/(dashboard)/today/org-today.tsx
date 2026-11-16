import Link from "next/link";
import { BellRing, FileBarChart, ShieldCheck } from "lucide-react";
import type { SchoolUser } from "@/lib/auth/session";
import type { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { friendlyTime, hhmm, localDate, localTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { KpiStrip, LiveDot } from "@/components/dashboard/today-blocks";

type Db = Awaited<ReturnType<typeof createClient>>;
type School = { name: string; timezone: string; resumption_time: string; closing_time: string; staff_pin_required?: boolean | null; staff_photo?: boolean | null };

/** An organisation's Today: who is in, who was late, who hasn't arrived, and anything that needs a look. */
export async function OrgToday({ user, supabase, school, now }: { user: SchoolUser; supabase: Db; school: School; now: Date }) {
  const tz = school.timezone;
  const today = localDate(now, tz);
  const isAdmin = user.role === "school_admin";
  const [{ data: staff }, { data: rows }, { count: unread }, { data: refused }] = await Promise.all([
    supabase.from("staff").select("id, name, photo_url").eq("status", "active").order("name"),
    supabase.from("attendance").select("holder_id, sign_in_at, sign_out_at, early_release").eq("holder_type", "staff").eq("date", today),
    isAdmin ? supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null) : Promise.resolve({ count: 0 }),
    isAdmin ? supabase.from("tap_events").select("id, holder_id, tapped_at").eq("result", "staff_refused").gte("tapped_at", `${today}T00:00:00Z`).order("tapped_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
  ]);
  const byId = new Map((rows ?? []).map((r) => [r.holder_id as string, r]));
  const people = staff ?? [];
  const photos = await signPhotos(supabase, people.map((p) => p.photo_url));
  const start = hhmm(school.resumption_time);
  const isLate = (at: string | null) => !!at && localTime(at, tz) > start;
  const inNow = people.filter((p) => { const r = byId.get(p.id); return r?.sign_in_at && !r.sign_out_at; }).length;
  const arrived = people.filter((p) => byId.get(p.id)?.sign_in_at).length;
  const late = people.filter((p) => isLate(byId.get(p.id)?.sign_in_at ?? null)).length;
  const notIn = people.length - arrived;
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const dateLine = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);

  // Not in yet first, then in (latest first), then gone home.
  const order = (id: string) => { const r = byId.get(id); return !r?.sign_in_at ? 0 : !r.sign_out_at ? 1 : 2; };
  const sorted = [...people].sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));

  return (
    <>
      <AutoRefresh />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="motion-rise">
          <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">{dateLine} · {school.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveDot label="Live · updates every 20 s" />
          <Button asChild variant="outline" className="motion-press">
            <Link href={`/reports?who=staff&from=${today}&to=${today}`}><FileBarChart className="size-4" /> Today&apos;s report</Link>
          </Button>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="surface rounded-xl p-6 text-sm">
          <p className="font-semibold text-ink">Add your staff to get started</p>
          <p className="mt-1 text-muted-foreground">Add each person on the <Link href="/staff" className="text-brand hover:underline">Staff</Link> page, give them a card, then register a kiosk on <Link href="/devices" className="text-brand hover:underline">Devices</Link>.</p>
        </div>
      ) : (
        <>
          <KpiStrip items={[
            { label: "In now", value: inNow, of: people.length, lead: true, caption: `${arrived} arrived today` },
            { label: "Late", value: late, tone: late ? "warn" : undefined, caption: `After ${friendlyTime(`${today}T${start}:00Z`, "UTC")}` }, // the start time as written, no timezone shift
            { label: "Not in yet", value: notIn, tone: notIn ? "negative" : undefined, caption: "No check-in today" },
            { label: "Notices", value: unread ?? 0, caption: "Unread alerts" },
          ]} />

          {(refused ?? []).length > 0 && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950" role="status">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>Refused at the kiosk today: {(refused ?? []).map((t) => `${nameOf.get(t.holder_id as string) ?? "someone"} (${friendlyTime(t.tapped_at, tz)})`).join(", ")}. Wrong PIN or outside the allowed hours.</p>
            </div>
          )}
          {(unread ?? 0) > 0 && (
            <p className="mt-4 text-sm"><Link href="/alerts" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><BellRing className="size-4" aria-hidden /> {unread} unread notice{unread === 1 ? "" : "s"}</Link></p>
          )}

          <section className="motion-rise mt-6 surface rounded-xl p-5" aria-labelledby="staff-today">
            <h2 id="staff-today" className="text-base font-semibold text-ink">Staff today</h2>
            <ul className="mt-3 divide-y divide-border">
              {sorted.map((p) => {
                const r = byId.get(p.id);
                return (
                  <li key={p.id}>
                    <Link href={`/staff?person=${p.id}`} className="flex items-center gap-3 py-2.5 hover:bg-muted/40">
                      <PersonAvatar name={p.name} src={p.photo_url ? photos.get(p.photo_url) ?? null : null} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {r?.sign_in_at ? `In ${friendlyTime(r.sign_in_at, tz)}` : "Not in yet"}
                          {r?.sign_out_at ? ` · ${r.early_release ? "left early" : "out"} ${friendlyTime(r.sign_out_at, tz)}` : ""}
                        </span>
                      </span>
                      {!r?.sign_in_at ? <StatusPill tone="slate">Not in</StatusPill>
                        : r.sign_out_at ? <StatusPill tone="slate">Gone</StatusPill>
                        : isLate(r.sign_in_at) ? <StatusPill tone="amber">Late</StatusPill>
                        : <StatusPill tone="green">In</StatusPill>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          {isAdmin && !school.staff_pin_required && !school.staff_photo && (
            <p className="mt-4 text-xs text-muted-foreground">Want to be sure who tapped? Turn on PIN and photo checks in <Link href="/settings" className="text-brand hover:underline">Settings → Staff check-in security</Link>.</p>
          )}
        </>
      )}
    </>
  );
}
