import { MessageSquare, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { formatNgPhone } from "@/lib/phone";
import { buildHeatmap, localDate } from "@/lib/heatmap";
import type { SchoolUser } from "@/lib/auth/session";
import { DrawerShell } from "@/components/dashboard/drawer-shell";
import { AttendanceHeatmap } from "@/components/dashboard/heatmap";
import { CardPill, StatusPill, cardState } from "@/components/dashboard/status-pill";
import { PhotoEditor } from "@/components/enroll/photo-editor";
import { AssignCardDialog } from "@/components/enroll/assign-card-dialog";
import { BlockCardButton } from "@/components/enroll/card-actions";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StudentDialog } from "./student-dialog";
import { GuardianForm } from "./guardian-form";
import { unlinkGuardian } from "./actions";
import { ExcusalForm } from "./excusal-form";
import { ConsentForm } from "./consent-form";
import { withdrawConsent } from "./consent-actions";
import { ShieldCheck } from "lucide-react";
import { ReleaseButton } from "@/components/enroll/release-button";
import { friendlyTime } from "@/lib/time";
import { removeExcusal } from "./excusal-actions";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DrawerLoading({ closeHref }: { closeHref: string }) {
  return (
    <DrawerShell closeHref={closeHref} title="Loading…">
      <div className="flex flex-col items-center gap-3 py-6" aria-busy="true">
        <Skeleton className="size-40 rounded-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </DrawerShell>
  );
}

export async function StudentDrawer({ studentId, closeHref, user, classes }: {
  studentId: string; closeHref: string; user: SchoolUser; classes: { id: string; name: string }[];
}) {
  const supabase = await createClient();
  const isAdmin = user.role === "school_admin";

  const { data: s } = await supabase.from("students").select("id, admission_no, first_name, last_name, class_id, photo_url, status, created_at, consent_at, consent_note").eq("id", studentId).maybeSingle();
  if (!s) notFound();

  const { data: school } = await supabase.from("schools").select("timezone, resumption_time").eq("id", user.schoolId).single();
  const tz = school?.timezone ?? "Africa/Lagos";
  const today = localDate(new Date(), tz);
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 7 * 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const [guardians, cards, attendance, holidays, sms, excusals] = await Promise.all([
    isAdmin
      ? supabase.from("student_guardians").select("guardians(id, name, phone, relationship)").eq("student_id", s.id)
      : Promise.resolve({ data: [] as { guardians: unknown }[] }),
    isAdmin
      ? supabase.from("cards").select("id, uid, status, verified_at, created_at").eq("holder_type", "student").eq("holder_id", s.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; uid: string; status: string; verified_at: string | null; created_at: string }[] }),
    supabase.from("attendance").select("date, sign_in_at, sign_out_at, early_release").eq("holder_type", "student").eq("holder_id", s.id).gte("date", sinceStr),
    supabase.from("school_calendar").select("date").eq("is_holiday", true).gte("date", sinceStr),
    isAdmin
      ? supabase.from("sms_logs").select("id, type, status, message, created_at").eq("student_id", s.id).order("created_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as { id: string; type: string; status: string; message: string; created_at: string }[] }),
    supabase.from("excusals").select("id, date, reason").eq("student_id", s.id).gte("date", sinceStr).order("date", { ascending: false }),
  ]);

  const photo = (await signPhotos(supabase, [s.photo_url])).get(s.photo_url ?? "") ?? null;
  const name = `${s.first_name} ${s.last_name}`;
  const className = classes.find((c) => c.id === s.class_id)?.name ?? null;
  const guardianList = (guardians.data ?? []).map((g) => g.guardians as unknown as { id: string; name: string; phone: string; relationship: string | null }).filter(Boolean);
  const activeCard = (cards.data ?? []).find((c) => c.status === "active") ?? null;
  const latestCard = activeCard ?? (cards.data ?? [])[0] ?? null;
  const heat = buildHeatmap({
    today, weeks: 12, attendance: attendance.data ?? [], holidays: (holidays.data ?? []).map((h) => h.date),
    resumptionTime: school?.resumption_time ?? "07:45", timeZone: tz, since: s.created_at.slice(0, 10),
    excused: (excusals.data ?? []).map((x) => x.date),
  });

  return (
    <DrawerShell closeHref={closeHref} title={name} description={`${s.admission_no}${className ? ` · ${className}` : ""}`}>
      {isAdmin && (
        <Section title="Parental consent">
          {s.consent_at ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
              <p className="flex items-start gap-2 text-sm text-ink">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>Consent recorded for {new Date(s.consent_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}{s.consent_note ? <span className="text-muted-foreground"> · {s.consent_note}</span> : null}</span>
              </p>
              <ConfirmAction action={withdrawConsent} fields={{ student_id: s.id }} title="Withdraw consent?"
                description="The photo is deleted straight away and no new photo can be added. Attendance records stay until the student leaves."
                confirmLabel="Withdraw consent" trigger={<Button variant="ghost" size="sm" className="text-red-700">Withdraw</Button>} />
            </div>
          ) : (
            <ConsentForm studentId={s.id} today={today} />
          )}
        </Section>
      )}

      <Section title="Photo">
        {isAdmin && s.consent_at ? (
          <PhotoEditor schoolId={user.schoolId} holderType="student" holderId={s.id} name={name} photoUrl={photo} />
        ) : (
          <p className="text-sm text-muted-foreground">{isAdmin ? "Record parental consent above to add a photo." : "—"}</p>
        )}
        {s.consent_at && !s.photo_url && <p className="mt-3 text-center text-sm text-amber-900">A photo is required before the card can be verified.</p>}
      </Section>

      <Section title="Details" action={isAdmin ? <StudentDialog classes={classes} existing={s} /> : undefined}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-muted-foreground">Admission no.</dt><dd className="font-medium tabular-nums text-ink">{s.admission_no}</dd></div>
          <div><dt className="text-muted-foreground">Class</dt><dd className="font-medium text-ink">{className ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd><StatusPill tone={s.status === "active" ? "green" : "slate"}>{s.status[0]!.toUpperCase() + s.status.slice(1)}</StatusPill></dd></div>
        </dl>
      </Section>

      {isAdmin && (
        <Section title="Card">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
            <div>
              <CardPill state={cardState(latestCard)} />
              {latestCard && <p className="mt-1.5 font-mono text-sm text-muted-foreground">••••{latestCard.uid.slice(-4)}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {s.status === "active" && (
                <AssignCardDialog holder={{ type: "student", id: s.id, name, className, photoUrl: photo }} hasCard={!!activeCard} />
              )}
              {activeCard && !activeCard.verified_at && s.status === "active" && (
                <AssignCardDialog holder={{ type: "student", id: s.id, name, className, photoUrl: photo }} hasCard mode="test"
                  trigger={<Button variant="outline">Test card</Button>} />
              )}
              {latestCard && (latestCard.status === "active" || latestCard.status === "blocked") && (
                <BlockCardButton cardId={latestCard.id} holderName={s.first_name} blocked={latestCard.status === "blocked"} size="default" />
              )}
            </div>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section title="Guardians">
          {guardianList.length === 0 ? (
            <p className="mb-4 text-sm text-muted-foreground">No guardians yet. Add at least one so arrival and absence alerts can be sent.</p>
          ) : (
            <ul className="mb-4 divide-y divide-border rounded-xl border border-border">
              {guardianList.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium text-ink">{g.name}{g.relationship && <span className="font-normal text-muted-foreground"> · {g.relationship}</span>}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">{formatNgPhone(g.phone)}</p>
                  </div>
                  <ConfirmAction action={unlinkGuardian} fields={{ student_id: s.id, guardian_id: g.id }}
                    title={`Remove ${g.name}?`} description={`${g.name} will stop getting alerts about ${s.first_name}.`} confirmLabel="Remove"
                    trigger={<Button variant="ghost" size="sm" aria-label={`Remove ${g.name}`}><Trash2 className="size-4" /></Button>} />
                </li>
              ))}
            </ul>
          )}
          {guardianList.length < 4 && <GuardianForm studentId={s.id} />}
        </Section>
      )}

      {(() => {
        const t = (attendance.data ?? []).find((a) => a.date === today);
        if (!t?.sign_in_at || s.status !== "active") return null;
        return (
          <Section title="Today">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4 text-sm">
              <p className="text-ink">
                In at <span className="font-medium tabular-nums">{friendlyTime(t.sign_in_at, tz)}</span>
                {t.sign_out_at && <> · {t.early_release ? "left early" : "out"} at <span className="font-medium tabular-nums">{friendlyTime(t.sign_out_at, tz)}</span></>}
              </p>
              {!t.sign_out_at && <ReleaseButton holderType="student" holderId={s.id} name={s.first_name} />}
            </div>
          </Section>
        );
      })()}

      <Section title="Excused absences">
        {(excusals.data ?? []).length > 0 && (
          <ul className="mb-4 divide-y divide-border rounded-xl border border-border text-sm">
            {(excusals.data ?? []).slice(0, 10).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span><span className="font-medium tabular-nums text-ink">{new Date(`${x.date}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span> <span className="text-muted-foreground">· {x.reason}</span></span>
                <ConfirmAction action={removeExcusal} fields={{ id: x.id }} title="Remove this excusal?" description="If the day hasn't passed, an absence SMS may be sent." confirmLabel="Remove"
                  trigger={<Button variant="ghost" size="sm" aria-label="Remove excusal"><Trash2 className="size-4" /></Button>} />
              </li>
            ))}
          </ul>
        )}
        {s.status === "active" && <ExcusalForm studentId={s.id} today={today} />}
      </Section>

      <Section title="Attendance — last 12 weeks">
        <AttendanceHeatmap columns={heat} />
      </Section>

      {isAdmin && (
        <Section title="SMS history">
          {(sms.data ?? []).length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><MessageSquare className="size-4" aria-hidden /> No messages sent yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(sms.data ?? []).map((m) => (
                <li key={m.id} className="rounded-lg bg-muted/50 px-3 py-2">
                  <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{m.type}</span>
                    <span>{new Date(m.created_at).toLocaleString("en-NG", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} · {m.status}</span>
                  </div>
                  <p className="mt-1 text-ink">{m.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </DrawerShell>
  );
}
