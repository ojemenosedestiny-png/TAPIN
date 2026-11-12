import type { Metadata } from "next";
import { ShieldCheck, ShieldX } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { formatNgPhone } from "@/lib/phone";
import { friendlyTime, localDate } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { PhotoEditor } from "@/components/enroll/photo-editor";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/field";
import { cn } from "@/lib/utils";
import { CardDialog, CodeDialog, PersonDialog, QrPassDialog, StatusDot, type StudentOpt } from "./forms";
import { cancelPickupCode, deletePickupPerson, setPickupCardBlocked, setPickupStatus } from "./actions";

export const metadata: Metadata = { title: "Safe pickup" };

type Person = {
  id: string; name: string; relationship: string | null; phone: string | null; photo_url: string | null; status: string;
  added_by: string; card_uid: string | null; card_blocked: boolean; qr_issued_at: string | null; pickup_people_students: { student_id: string }[];
};
type Event = { id: string; kind: string; student_id: string | null; picker_name: string; at: string };

export default async function PickupPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("pickup");
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("timezone").eq("id", user.schoolId).single();
  const tz = school?.timezone ?? "Africa/Lagos";
  const today = localDate(new Date(), tz);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const dayStart = new Date(`${day}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(new Date(dayStart).getTime() + 86_400_000).toISOString();

  const [{ data: people }, { data: students }, { data: events }, { data: codes }] = await Promise.all([
    supabase.from("pickup_people").select("id, name, relationship, phone, photo_url, status, added_by, card_uid, card_blocked, qr_issued_at, pickup_people_students(student_id)").order("name"),
    supabase.from("students").select("id, first_name, last_name, classes(name)").eq("status", "active").order("first_name").limit(5000),
    supabase.from("pickup_events").select("id, kind, student_id, picker_name, at").gte("at", dayStart).lt("at", dayEnd).order("at", { ascending: false }).limit(500),
    supabase.from("pickup_codes").select("id, person_name, valid_date, used_at, pickup_code_students(student_id)").gte("valid_date", today).order("valid_date"),
  ]);
  const list = (people ?? []) as unknown as Person[];
  const opts: StudentOpt[] = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, class: (s.classes as unknown as { name: string } | null)?.name ?? null }));
  const nameOf = new Map(opts.map((s) => [s.id, s.name]));
  const photos = await signPhotos(supabase, list.map((p) => p.photo_url));
  const log = (events ?? []) as Event[];
  const pending = list.filter((p) => p.status === "pending");

  return (
    <>
      <PageHeader title="Safe pickup" description="Who may collect each child. Staff see the person's photo next to the children and confirm before anyone leaves.">
        <div className="flex flex-wrap gap-2">
          <CodeDialog students={opts} />
          <PersonDialog students={opts} />
        </div>
      </PageHeader>

      {pending.length > 0 && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          {pending.length === 1 ? "1 person is" : `${pending.length} people are`} waiting for a parent&apos;s approval. You can approve them here after speaking to the parent.
        </p>
      )}

      {/* The day's log */}
      <section aria-labelledby="log-h" className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="log-h" className="text-lg font-semibold text-ink">{day === today ? "Today" : day}</h2>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="day" className="sr-only">Day</label>
            <input id="day" type="date" name="day" defaultValue={day} max={today} className={selectClass} />
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        </div>
        {log.length ? (
          <ul className="surface mt-3 divide-y divide-border rounded-xl">
            {log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                {e.kind === "picked_up" ? <ShieldCheck className="size-4 text-green-700" aria-hidden /> : <ShieldX className="size-4 text-red-700" aria-hidden />}
                <span className="tabular-nums text-muted-foreground">{friendlyTime(e.at, tz)}</span>
                <span className="min-w-0 flex-1 text-ink">
                  {e.kind === "picked_up"
                    ? <><strong className="font-medium">{e.student_id ? nameOf.get(e.student_id) ?? "A child" : "A child"}</strong> picked up by {e.picker_name}</>
                    : <><strong className="font-medium text-red-800">Not authorised:</strong> {e.picker_name}{e.student_id ? ` (linked to ${nameOf.get(e.student_id) ?? "a child"})` : ""}</>}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No pickups recorded {day === today ? "yet today" : "on this day"}.</p>}
      </section>

      {/* Codes */}
      {(codes ?? []).length > 0 && (
        <section aria-labelledby="codes-h" className="mb-8">
          <h2 id="codes-h" className="text-lg font-semibold text-ink">One-day codes</h2>
          <ul className="surface mt-3 divide-y divide-border rounded-xl">
            {(codes ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1"><span className="font-medium text-ink">{c.person_name}</span>
                  <span className="text-muted-foreground"> · {(c.pickup_code_students as { student_id: string }[]).map((s) => nameOf.get(s.student_id)).filter(Boolean).join(", ")} · {c.valid_date === today ? "today" : c.valid_date}</span></span>
                {c.used_at ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Used {friendlyTime(c.used_at, tz)}</span> : (
                  <ConfirmAction action={cancelPickupCode} fields={{ id: c.id }} title={`Cancel ${c.person_name}'s code?`} description="The code stops working straight away." confirmLabel="Cancel code"
                    trigger={<Button variant="ghost" size="sm" className="text-red-700">Cancel</Button>} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* People */}
      <section aria-labelledby="people-h">
        <h2 id="people-h" className="text-lg font-semibold text-ink">Pickup people</h2>
        {list.length === 0 ? (
          <div className="mt-3"><EmptyState icon={<ShieldCheck className="size-7" aria-hidden />} title="No pickup people yet"
            body="Add parents, relatives and drivers who collect children. Give each a pickup card, or use a one-day code for someone collecting once."
            action={<PersonDialog students={opts} />} /></div>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {list.map((p) => {
              const kids = p.pickup_people_students.map((l) => nameOf.get(l.student_id)).filter((n): n is string => !!n);
              return (
                <li key={p.id} className={cn("surface flex flex-col gap-3 rounded-2xl p-4", p.status === "revoked" && "opacity-70")}>
                  <div className="flex items-start gap-3">
                    <PersonAvatar name={p.name} src={p.photo_url ? photos.get(p.photo_url) ?? null : null} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{p.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{[p.relationship, p.phone ? formatNgPhone(p.phone) : null].filter(Boolean).join(" · ") || "—"}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusDot status={p.status} blocked={p.card_blocked} />
                        <span className="text-xs text-muted-foreground">{p.card_uid ? `Card …${p.card_uid.slice(-4)}` : "No card"}{p.qr_issued_at ? " · QR pass" : ""}{p.added_by === "parent" ? " · added by parent" : ""}</span>
                      </div>
                    </div>
                    <PersonDialog students={opts} person={{ id: p.id, name: p.name, relationship: p.relationship, phone: p.phone ? formatNgPhone(p.phone) : "", student_ids: p.pickup_people_students.map((l) => l.student_id) }} />
                  </div>
                  <p className="text-sm text-ink"><span className="text-muted-foreground">Collects: </span>{kids.join(", ") || "no children"}</p>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <PhotoEditor schoolId={user.schoolId} holderType="pickup" holderId={p.id} name={p.name} photoUrl={p.photo_url ? photos.get(p.photo_url) ?? null : null} />
                    <CardDialog id={p.id} name={p.name} hasCard={!!p.card_uid} />
                    <QrPassDialog id={p.id} name={p.name} hasPass={!!p.qr_issued_at} />
                    {p.card_uid && (
                      <ConfirmAction action={setPickupCardBlocked} fields={{ id: p.id, blocked: p.card_blocked ? "0" : "1" }} destructive={!p.card_blocked}
                        title={p.card_blocked ? `Unblock ${p.name}'s card?` : `Block ${p.name}'s card?`}
                        description={p.card_blocked ? "The card works at the kiosk again." : "For a lost card. It will show \"Not authorised\" and alert you and the parents."}
                        confirmLabel={p.card_blocked ? "Unblock" : "Block card"} trigger={<Button variant="ghost" size="sm">{p.card_blocked ? "Unblock card" : "Block card"}</Button>} />
                    )}
                    {p.status !== "active" ? (
                      <ConfirmAction action={setPickupStatus} fields={{ id: p.id, status: "active" }} destructive={false} title={`Allow ${p.name}?`}
                        description="Only after a parent has confirmed this person may collect their child." confirmLabel="Allow" trigger={<Button variant="ghost" size="sm" className="text-green-800">{p.status === "pending" ? "Approve" : "Allow again"}</Button>} />
                    ) : (
                      <ConfirmAction action={setPickupStatus} fields={{ id: p.id, status: "revoked" }} title={`Stop ${p.name} collecting?`}
                        description="Their card will show &quot;Not authorised&quot; at the kiosk, and you and the parents are told if they try." confirmLabel="Stop" trigger={<Button variant="ghost" size="sm" className="text-red-700">Stop</Button>} />
                    )}
                    <span className="ml-auto">
                      <ConfirmDelete action={deletePickupPerson} id={p.id} label={`Remove ${p.name}`} variant="ghost" title={`Remove ${p.name}?`}
                        body={<p>Their card stops working. The pickup log keeps their name.</p>} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
