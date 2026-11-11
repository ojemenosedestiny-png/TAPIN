import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { duration, rollCounts, type RollPerson } from "@/lib/emergency";
import { friendlyTime } from "@/lib/time";
import { Logo } from "@/components/brand/logo";
import { PoweredBy } from "@/components/brand/powered-by";
import { Button } from "@/components/ui/button";
import { PrintButton } from "../../reports/print-button";
import { RollList } from "../roll";

export const metadata: Metadata = { title: "Incident report" };

/** The incident report for one roll call. Print → Save as PDF. */
export default async function IncidentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSchoolArea("emergency");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  if (!planAllows(await getSchoolPlan(db, user.schoolId), "emergency")) notFound();
  const [{ data: school }, { data: em }] = await Promise.all([
    db.from("schools").select("name, timezone").eq("id", user.schoolId).single(),
    db.from("emergencies").select("id, kind, reason, started_at, ended_at, broadcast_at, started_by_user, started_device, ended_by_user").eq("id", id).eq("school_id", user.schoolId).maybeSingle(),
  ]);
  if (!em) notFound();
  const tz = school?.timezone ?? "Africa/Lagos";
  const [{ data: people }, { data: users }, { data: device }] = await Promise.all([
    db.from("emergency_people").select("id, holder_type, holder_id, name, group_name, on_roster, safe_at, marked_by").eq("emergency_id", id),
    db.from("users").select("id, name").in("id", [em.started_by_user, em.ended_by_user].filter((x): x is string => !!x)),
    em.started_device ? db.from("devices").select("name").eq("id", em.started_device).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const roll = (people ?? []) as RollPerson[];
  const c = rollCounts(roll);
  const nameOf = new Map((users ?? []).map((u) => [u.id, u.name]));
  const lastSafe = roll.map((p) => p.safe_at).filter((t): t is string => !!t).sort().at(-1);
  const date = new Date(em.started_at).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });

  return (
    <article className="space-y-6 [print-color-adjust:exact]">
      <div className="flex flex-wrap justify-between gap-2 print:hidden">
        <Button asChild variant="outline"><Link href="/emergency"><ArrowLeft className="size-4" aria-hidden /> Emergency</Link></Button>
        <PrintButton />
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          <Logo className="size-12" />
          <div>
            <h1 className="font-heading text-2xl font-semibold text-ink">{em.kind === "drill" ? "Drill report" : "Incident report"}</h1>
            <p className="text-sm text-muted-foreground">{school?.name} · {date}</p>
          </div>
        </div>
        <PoweredBy />
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Started", `${friendlyTime(em.started_at, tz)} by ${em.started_by_user ? nameOf.get(em.started_by_user) ?? "staff" : device?.name ? `kiosk ${device.name}` : "kiosk"}`],
          ["Ended", em.ended_at ? `${friendlyTime(em.ended_at, tz)}${em.ended_by_user ? ` by ${nameOf.get(em.ended_by_user) ?? "staff"}` : ""}` : "Still running"],
          ["Everyone safe in", c.missing === 0 && lastSafe ? duration(em.started_at, lastSafe) : "—"],
          ["Parents messaged", em.broadcast_at ? friendlyTime(em.broadcast_at, tz) : "No"],
        ].map(([k, v]) => (
          <div key={k} className="surface rounded-xl px-4 py-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm font-medium text-ink">{v}</dd></div>
        ))}
      </dl>
      {em.reason && <p className="text-sm text-ink"><span className="text-muted-foreground">Reason: </span>{em.reason}</p>}

      <div className="grid grid-cols-3 gap-3">
        <div className="surface rounded-2xl px-4 py-4"><p className="text-sm text-muted-foreground">On the roll</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{c.total}</p></div>
        <div className="surface rounded-2xl px-4 py-4"><p className="text-sm text-muted-foreground">Safe</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums text-green-800">{c.safe}</p></div>
        <div className="surface rounded-2xl px-4 py-4"><p className="text-sm text-muted-foreground">Not accounted for</p><p className={`mt-1 font-heading text-3xl font-semibold tabular-nums ${c.missing ? "text-red-700" : ""}`}>{c.missing}</p></div>
      </div>

      <RollList people={roll} tz={tz} live={false} />
    </article>
  );
}
