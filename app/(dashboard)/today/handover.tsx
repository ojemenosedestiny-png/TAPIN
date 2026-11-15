import Link from "next/link";
import { AlertTriangle, ShieldX, Lock, Clock } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyTime, hhmm, localTime } from "@/lib/time";
import { BlockHeading } from "@/components/dashboard/today-blocks";
import { RequestButtons } from "./request-buttons";

type Name = { first_name: string; last_name: string; classes?: { name: string } | null } | null;
const full = (s: Name) => (s ? `${s.first_name} ${s.last_name}` : "A student");
const atTime = (t: string | null) => (t ? friendlyTime(new Date(`2026-01-01T${t.slice(0, 5)}:00Z`), "UTC") : null);

export type HandoverData = Awaited<ReturnType<typeof loadHandoverData>>;

/** Everything the Today page shows about drop-off, pickup, requests and flags. School admins only (RLS). */
export async function loadHandoverData(supabase: SupabaseClient, o: { today: string; tz: string; closing: string }) {
  const now = new Date();
  const afterClosing = localTime(now, o.tz) >= hhmm(o.closing);
  const [{ data: requests }, { data: handovers }, { data: locked }, { data: still }, { data: attendance }] = await Promise.all([
    supabase.from("early_pickup_requests").select("id, at_time, note, student_id, students(first_name, last_name, classes(name)), guardians(name)")
      .eq("date", o.today).eq("status", "pending").order("at_time", { nullsFirst: false }),
    supabase.from("handovers").select("id, kind, status, student_id, completed_at, started_at, note, pickup_people(name), students(first_name, last_name, transport, classes(name))")
      .eq("date", o.today).not("student_id", "is", null).order("started_at", { ascending: false }).limit(300),
    supabase.from("devices").select("id, name, code_locked_until").is("revoked_at", null).gt("code_locked_until", now.toISOString()),
    afterClosing
      ? supabase.from("attendance").select("holder_id, sign_in_at").eq("holder_type", "student").eq("date", o.today).not("sign_in_at", "is", null).is("sign_out_at", null).limit(200)
      : Promise.resolve({ data: [] as { holder_id: string; sign_in_at: string }[] }),
    supabase.from("attendance").select("holder_id, sign_in_at, sign_out_at, picked_up_by").eq("holder_type", "student").eq("date", o.today).limit(5000),
  ]);
  const stillIds = (still ?? []).map((r) => r.holder_id as string);
  const { data: stillKids } = stillIds.length
    ? await supabase.from("students").select("id, first_name, last_name, transport, classes(name)").in("id", stillIds)
    : { data: [] };
  return { afterClosing, requests: requests ?? [], handovers: handovers ?? [], locked: locked ?? [], stillKids: stillKids ?? [], attendance: attendance ?? [] };
}

/** The rail block: what the office should do something about today. Hidden when there's nothing. */
export function NeedsAction({ data, tz }: { data: HandoverData; tz: string }) {
  const flags = data.handovers.filter((h) => h.status === "no_parent" || h.status === "refused");
  const items = data.requests.length + flags.length + data.locked.length + data.stillKids.length;
  if (!items) return null;
  return (
    <section aria-labelledby="needs-action" className="motion-rise" style={{ "--d": "80ms" } as React.CSSProperties}>
      <BlockHeading title={`Needs action (${items})`} />
      <ul className="divide-y divide-border overflow-hidden surface rounded-xl">
        {data.requests.map((r) => {
          const s = r.students as unknown as Name;
          const g = r.guardians as unknown as { name: string } | null;
          const at = atTime(r.at_time as string | null);
          return (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <Clock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">Early pickup: {full(s)}{at ? ` at ${at}` : ""}</p>
                <p className="truncate text-xs text-muted-foreground">{g?.name ?? "A parent"} · by WhatsApp{r.note ? ` · "${r.note}"` : ""}</p>
              </div>
              <RequestButtons id={r.id as string} child={s?.first_name ?? "this child"} />
            </li>
          );
        })}
        {flags.map((h) => {
          const s = h.students as unknown as Name;
          const refused = h.status === "refused";
          const who = (h.pickup_people as unknown as { name: string } | null)?.name;
          return (
            <li key={h.id} className="flex items-start gap-3 px-4 py-3">
              {refused ? <ShieldX className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{refused ? `Pickup refused: ${full(s)}` : `No parent at drop-off: ${full(s)}`}</p>
                <p className="text-xs text-muted-foreground">
                  {refused ? `${who ?? "Someone"} is not linked to this child · ` : ""}{friendlyTime(h.completed_at ?? h.started_at, tz)}
                </p>
              </div>
              <Link href={`/students?student=${h.student_id}`} className="shrink-0 text-xs font-medium text-brand hover:underline">Open</Link>
            </li>
          );
        })}
        {data.locked.map((d) => (
          <li key={d.id} className="flex items-start gap-3 px-4 py-3">
            <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Pickup codes locked on {d.name}</p>
              <p className="text-xs text-muted-foreground">Five wrong codes · until {friendlyTime(d.code_locked_until as string, tz)}</p>
            </div>
            <Link href="/devices" className="shrink-0 text-xs font-medium text-brand hover:underline">Unlock</Link>
          </li>
        ))}
        {data.stillKids.length > 0 && (
          <li className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Still in school after closing ({data.stillKids.length})</p>
              <p className="text-xs text-muted-foreground">
                {data.stillKids.slice(0, 8).map((k) => `${k.first_name} ${k.last_name}${k.transport === "bus" ? " (bus)" : ""}`).join(", ")}
                {data.stillKids.length > 8 ? ` and ${data.stillKids.length - 8} more` : ""}
              </p>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Who brought and who collected each child today. Shown when the school uses handover, or anyone was handed over. */
export function HandoverBoard({ data, tz, enabled }: { data: HandoverData; tz: string; enabled: boolean }) {
  // One row per child: their drop-off, then their pickup, from today's handovers and attendance.
  type Row = { id: string; name: string; cls: string | null; bus: boolean; inAt: string | null; dropBy: string | null; noParent: boolean; outAt: string | null; pickBy: string | null };
  const rows = new Map<string, Row>();
  const att = new Map(data.attendance.map((a) => [a.holder_id as string, a]));
  for (const h of data.handovers) {
    const id = h.student_id as string;
    const s = h.students as unknown as (Name & { transport: string }) | null;
    if (!s) continue;
    const a = att.get(id);
    const r = rows.get(id) ?? {
      id, name: full(s), cls: s.classes?.name ?? null, bus: s.transport === "bus", inAt: a?.sign_in_at ?? null, dropBy: null, noParent: false,
      outAt: a?.sign_out_at ?? null, pickBy: (a?.picked_up_by as string | null) ?? null,
    };
    const who = (h.pickup_people as unknown as { name: string } | null)?.name ?? null;
    if (h.kind === "drop_off" && h.status === "matched") r.dropBy = who;
    if (h.kind === "drop_off" && h.status === "no_parent") r.noParent = true;
    rows.set(id, r);
  }
  const list = [...rows.values()].slice(0, 60);
  if (!enabled && !list.length) return null;

  return (
    <section className="motion-rise surface rounded-xl p-5" style={{ "--d": "260ms" } as React.CSSProperties} aria-labelledby="handover-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="handover-h" className="text-base font-semibold text-ink">Drop-off and pickup</h2>
        <Link href="/pickup" className="text-xs font-medium text-brand hover:underline">Safe pickup</Link>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No handovers yet today. They appear here as parents tap their cards.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-2 pr-3 font-medium">Child</th><th className="py-2 pr-3 font-medium">Arrived</th><th className="py-2 font-medium">Left</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2.5 pr-3">
                    <Link href={`/students?student=${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                    <span className="block text-xs text-muted-foreground">{r.cls ?? "No class"}{r.bus ? " · bus" : ""}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.inAt ? <span className="tabular-nums">{friendlyTime(r.inAt, tz)}</span> : "—"}
                    <span className={r.noParent ? "block text-xs font-medium text-amber-800" : "block text-xs text-muted-foreground"}>
                      {r.dropBy ? `by ${r.dropBy}` : r.noParent ? "no parent tapped" : r.bus ? "bus" : ""}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {r.outAt ? <span className="tabular-nums">{friendlyTime(r.outAt, tz)}</span> : <span className="text-muted-foreground">Still in school</span>}
                    {r.outAt && <span className="block text-xs text-muted-foreground">{r.pickBy ? `with ${r.pickBy}` : r.bus ? "bus" : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

