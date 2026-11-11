import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Siren } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { defaultBroadcast, duration, rollCounts, type RollPerson } from "@/lib/emergency";
import { friendlyTime } from "@/lib/time";
import { PageHeader } from "@/components/dashboard/page-header";
import { UpgradePrompt } from "@/components/dashboard/upgrade";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BroadcastDialog, PinForm, StartRollCall } from "./forms";
import { endRollCall } from "./actions";
import { RollList } from "./roll";

export const metadata: Metadata = { title: "Emergency" };

export default async function EmergencyPage() {
  const user = await requireSchoolArea("emergency");
  const db = createAdminClient(); // scoped to the signed-in user's school below
  const plan = await getSchoolPlan(db, user.schoolId);
  if (!planAllows(plan, "emergency")) {
    return (
      <>
        <PageHeader title="Emergency roll call" description="Know who is safe in seconds, not minutes." />
        <UpgradePrompt feature="emergency" points={[
          "One button (PIN-protected) turns every kiosk into an assembly-point roll call.",
          "Live headcount of everyone tapped in today, grouped by class: safe and still missing.",
          "Teachers tick children safe on their phones; the list updates for everyone instantly.",
          "Optional message to all parents, and an incident report (PDF) when it's over.",
        ]} />
      </>
    );
  }

  const [{ data: school }, { data: running }, { data: settings }, { data: past }] = await Promise.all([
    db.from("schools").select("name, timezone").eq("id", user.schoolId).single(),
    db.from("emergencies").select("id, kind, reason, started_at, broadcast_at").eq("school_id", user.schoolId).is("ended_at", null).maybeSingle(),
    db.from("emergency_settings").select("pin_hash").eq("school_id", user.schoolId).maybeSingle(),
    db.from("emergencies").select("id, kind, started_at, ended_at").eq("school_id", user.schoolId).not("ended_at", "is", null).order("started_at", { ascending: false }).limit(20),
  ]);
  const tz = school?.timezone ?? "Africa/Lagos";
  const isAdmin = user.role === "school_admin";

  if (running) {
    const { data: people } = await db.from("emergency_people").select("id, holder_type, holder_id, name, group_name, on_roster, safe_at, marked_by").eq("emergency_id", running.id);
    const roll = (people ?? []) as RollPerson[];
    const c = rollCounts(roll);
    const drill = running.kind === "drill";
    return (
      <>
        <RealtimeRefresh table="emergency_people" filter={`emergency_id=eq.${running.id}`} />
        <div className={cn("-mx-4 -mt-6 mb-6 px-4 py-5 text-white sm:-mx-6 sm:px-6 lg:-mx-12 lg:-mt-12 lg:px-12", drill ? "bg-orange-700" : "bg-red-700")} role="alert">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em]"><Siren className="size-5 animate-pulse motion-reduce:animate-none" aria-hidden /> {drill ? "Drill in progress" : "Emergency roll call in progress"}</p>
          <p className="mt-1 text-white/85">Started {friendlyTime(running.started_at, tz)}{running.reason ? ` · ${running.reason}` : ""}. Every kiosk is marking people safe.</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="surface rounded-2xl px-4 py-4"><p className="text-sm text-muted-foreground">On the roll</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums text-ink">{c.total}</p></div>
          <div className="surface rounded-2xl px-4 py-4"><p className="text-sm text-muted-foreground">Safe</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums text-green-800">{c.safe}</p></div>
          <div className={cn("rounded-2xl px-4 py-4", c.missing ? "bg-red-600 text-white" : "surface")}><p className={cn("text-sm", c.missing ? "text-white/85" : "text-muted-foreground")}>Not yet</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{c.missing}</p></div>
        </div>

        {isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <BroadcastDialog id={running.id} sent={!!running.broadcast_at} defaultMessage={defaultBroadcast(running.kind as "real" | "drill", school?.name ?? "Your school")} />
            <ConfirmAction action={endRollCall} fields={{ id: running.id }} title="End the roll call?"
              description={c.missing ? `${c.missing} ${c.missing === 1 ? "person is" : "people are"} still not accounted for. They stay on the incident report as missing.` : "Everyone is accounted for. Kiosks go back to normal."}
              confirmLabel="End roll call" trigger={<Button variant="outline">End roll call</Button>} />
          </div>
        )}

        <div className="mt-6"><RollList people={roll} tz={tz} live /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Emergency roll call" description="In an evacuation, every kiosk becomes an assembly point. Staff tick the rest on their phones." />
      <section className="surface rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Start</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          From here, or from any kiosk with the Emergency button and the PIN. Use &ldquo;Drill&rdquo; for practice.
          {!isAdmin && " You'll need the emergency PIN."}
        </p>
        <StartRollCall needsPin={!isAdmin} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {isAdmin && (
          <section className="surface rounded-2xl p-5 sm:p-6" aria-labelledby="pin-h">
            <h2 id="pin-h" className="text-lg font-semibold text-ink">Kiosk emergency PIN</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">{settings?.pin_hash ? "A PIN is set." : "Not set yet: the kiosk Emergency button won't work until you set one."} 4 to 6 digits.</p>
            <PinForm hasPin={!!settings?.pin_hash} />
          </section>
        )}
        <section className="surface rounded-2xl p-5 sm:p-6" aria-labelledby="past-h">
          <h2 id="past-h" className="text-lg font-semibold text-ink">Past roll calls</h2>
          {(past ?? []).length ? (
            <ul className="mt-3 divide-y divide-border">
              {(past ?? []).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink">{new Date(e.started_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: tz })} · {friendlyTime(e.started_at, tz)}
                    <span className="text-muted-foreground"> · {e.kind === "drill" ? "Drill" : "Real"} · {duration(e.started_at, e.ended_at!)}</span></span>
                  <Button asChild variant="ghost" size="sm"><Link href={`/emergency/${e.id}`}><FileText className="size-4" aria-hidden /> Report</Link></Button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted-foreground">None yet. Running a drill each term is a good habit.</p>}
        </section>
      </div>
    </>
  );
}
