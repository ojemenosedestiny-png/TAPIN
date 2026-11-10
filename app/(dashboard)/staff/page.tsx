import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { requireSchoolArea, type SchoolUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { formatNgPhone } from "@/lib/phone";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { CardPill, StatusPill, cardState, type CardState } from "@/components/dashboard/status-pill";
import { DrawerShell } from "@/components/dashboard/drawer-shell";
import { PhotoEditor } from "@/components/enroll/photo-editor";
import { AssignCardDialog } from "@/components/enroll/assign-card-dialog";
import { BlockCardButton } from "@/components/enroll/card-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffDialog } from "./staff-dialog";
import { ReleaseButton } from "@/components/enroll/release-button";
import { friendlyTime, localDate } from "@/lib/time";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ person?: string; show?: string }> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("staff");
  const supabase = await createClient();
  const showInactive = sp.show === "all";

  let q = supabase.from("staff_overview").select("id, name, phone, photo_url, status, card_state").order("name");
  if (!showInactive) q = q.eq("status", "active");
  const { data: staff } = await q;
  const photos = await signPhotos(supabase, (staff ?? []).map((s) => s.photo_url));
  const close = showInactive ? "/staff?show=all" : "/staff";

  return (
    <>
      <PageHeader title="Staff" description="Teachers and staff who tap in at the gate.">
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href={showInactive ? "/staff" : "/staff?show=all"}>{showInactive ? "Active only" : "Show inactive"}</Link></Button>
          <StaffDialog />
        </div>
      </PageHeader>

      {(staff ?? []).length === 0 ? (
        <EmptyState icon={<Users className="size-7" aria-hidden />} title="No staff yet" body="Add staff who should tap in and out at the gate." action={<StaffDialog />} />
      ) : (
        <div className="overflow-x-auto surface rounded-xl">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium">Card</th>
                {showInactive && <th scope="col" className="px-4 py-3 font-medium">Status</th>}
              </tr>
            </thead>
            <tbody>
              {(staff ?? []).map((s) => (
                <tr key={s.id} className="group relative border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/staff?${showInactive ? "show=all&" : ""}person=${s.id}`} scroll={false} className="flex items-center gap-3 font-medium text-ink after:absolute after:inset-0 group-focus-within:underline focus-visible:outline-none">
                      <PersonAvatar name={s.name} src={s.photo_url ? photos.get(s.photo_url) : null} />
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.phone ? formatNgPhone(s.phone) : "—"}</td>
                  <td className="px-4 py-2.5"><CardPill state={s.card_state as CardState} /></td>
                  {showInactive && <td className="px-4 py-2.5"><StatusPill tone={s.status === "active" ? "green" : "slate"}>{s.status}</StatusPill></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sp.person && /^[0-9a-f-]{36}$/i.test(sp.person) && (
        <Suspense fallback={<DrawerShell closeHref={close} title="Loading…"><Skeleton className="mx-auto mt-6 size-40 rounded-full" /></DrawerShell>}>
          <StaffDrawer id={sp.person} user={user} closeHref={close} />
        </Suspense>
      )}
    </>
  );
}

async function StaffDrawer({ id, user, closeHref }: { id: string; user: SchoolUser; closeHref: string }) {
  const supabase = await createClient();
  const { data: s } = await supabase.from("staff").select("id, name, phone, photo_url, status").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: cards } = await supabase.from("cards").select("id, uid, status, verified_at").eq("holder_type", "staff").eq("holder_id", s.id).order("created_at", { ascending: false });
  const { data: school } = await supabase.from("schools").select("timezone").eq("id", user.schoolId).single();
  const tz = school?.timezone ?? "Africa/Lagos";
  const { data: todayRow } = await supabase.from("attendance").select("sign_in_at, sign_out_at, early_release")
    .eq("holder_type", "staff").eq("holder_id", s.id).eq("date", localDate(new Date(), tz)).maybeSingle();
  const photo = (await signPhotos(supabase, [s.photo_url])).get(s.photo_url ?? "") ?? null;
  const active = (cards ?? []).find((c) => c.status === "active") ?? null;
  const latest = active ?? (cards ?? [])[0] ?? null;
  const holder = { type: "staff" as const, id: s.id, name: s.name, className: "Staff", photoUrl: photo };

  return (
    <DrawerShell closeHref={closeHref} title={s.name} description={s.phone ? formatNgPhone(s.phone) : "Staff"}>
      <div className="py-6"><PhotoEditor schoolId={user.schoolId} holderType="staff" holderId={s.id} name={s.name} photoUrl={photo} /></div>
      <section className="border-t border-border py-6">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-semibold text-ink">Details</h3><StaffDialog existing={s} /></div>
        <StatusPill tone={s.status === "active" ? "green" : "slate"}>{s.status === "active" ? "Active" : "Inactive"}</StatusPill>
      </section>
      {todayRow?.sign_in_at && (
        <section className="border-t border-border py-6">
          <h3 className="mb-3 text-base font-semibold text-ink">Today</h3>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4 text-sm">
            <p className="text-ink">
              In at <span className="font-medium tabular-nums">{friendlyTime(todayRow.sign_in_at, tz)}</span>
              {todayRow.sign_out_at && <> · {todayRow.early_release ? "left early" : "out"} at <span className="font-medium tabular-nums">{friendlyTime(todayRow.sign_out_at, tz)}</span></>}
            </p>
            {!todayRow.sign_out_at && <ReleaseButton holderType="staff" holderId={s.id} name={s.name.split(" ")[0]!} />}
          </div>
        </section>
      )}
      <section className="border-t border-border py-6">
        <h3 className="mb-3 text-base font-semibold text-ink">Card</h3>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
          <div>
            <CardPill state={cardState(latest)} />
            {latest && <p className="mt-1.5 font-mono text-sm text-muted-foreground">••••{latest.uid.slice(-4)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {s.status === "active" && <AssignCardDialog holder={holder} hasCard={!!active} />}
            {active && !active.verified_at && <AssignCardDialog holder={holder} hasCard mode="test" trigger={<Button variant="outline">Test card</Button>} />}
            {latest && (latest.status === "active" || latest.status === "blocked") && (
              <BlockCardButton cardId={latest.id} holderName={s.name} blocked={latest.status === "blocked"} size="default" />
            )}
          </div>
        </div>
      </section>
    </DrawerShell>
  );
}
