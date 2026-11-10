import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { fetchAllPages } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { IdCard, type IdCardPerson } from "@/components/cards/id-card";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";

export const metadata: Metadata = { title: "Print ID cards" };

type Search = { class?: string; who?: string; layout?: string };

/** Print-ready ID cards: A4 sheets of 10 (cut out) or one per page for a PVC card printer. */
export default async function PrintCardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("cards");
  const supabase = await createClient();
  const layout = sp.layout === "printer" ? "printer" : "a4";
  const who = sp.who === "staff" ? "staff" : "students";
  const classId = sp.class && /^[0-9a-f-]{36}$/i.test(sp.class) ? sp.class : null;

  const [{ data: school }, { data: classes }] = await Promise.all([
    supabase.from("schools").select("name, logo_url").eq("id", user.schoolId).single(),
    supabase.from("classes").select("id, name").order("name"),
  ]);

  let people: (IdCardPerson & { photoPath: string | null })[] = [];
  if (who === "staff") {
    const { data } = await supabase.from("staff").select("id, name, photo_url").eq("status", "active").order("name");
    people = (data ?? []).map((s) => ({ id: s.id, name: s.name, role: "Staff", className: null, number: null, photoUrl: null, photoPath: s.photo_url }));
  } else if (classId) {
    const rows = await fetchAllPages<{ id: string; full_name: string; admission_no: string; class_name: string | null; photo_url: string | null }>((f, t) =>
      supabase.from("student_overview").select("id, full_name, admission_no, class_name, photo_url").eq("status", "active").eq("class_id", classId)
        .order("last_name").order("first_name").range(f, t));
    people = rows.map((s) => ({ id: s.id, name: s.full_name, role: "Student", className: s.class_name, number: s.admission_no, photoUrl: null, photoPath: s.photo_url }));
  }

  const signed = await signPhotos(supabase, [...people.map((p) => p.photoPath), school?.logo_url]);
  for (const p of people) p.photoUrl = p.photoPath ? signed.get(p.photoPath) ?? null : null;
  const schoolInfo = { name: school?.name ?? "", logoUrl: school?.logo_url ? signed.get(school.logo_url) ?? null : null };
  const noPhoto = people.filter((p) => !p.photoPath).length;

  const href = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ class: classId ?? undefined, who, layout, ...patch })) if (v) p.set(k, v);
    return `/cards/print?${p}`;
  };

  return (
    <>
      {/* Page size for printing: A4 with 10 cards, or exactly one card per page. */}
      <style>{layout === "printer"
        ? "@page { size: 85.6mm 54mm; margin: 0; } @media print { .card-page { break-after: page; } }"
        : "@page { size: A4; margin: 12mm 10mm; }"}</style>

      <div className="print:hidden">
        <Link href="/cards" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Cards</Link>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-ink">Print ID cards</h1>
            <p className="mt-1 text-sm text-muted-foreground">Bank-card size (85.6 × 54 mm). Print at 100% scale (“Actual size”), not “Fit to page”.</p>
          </div>
          {people.length > 0 && <PrintButton />}
        </div>

        <form action="/cards/print" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Who</span>
            <select name="who" defaultValue={who} className={cn(selectClass, "w-36")}>
              <option value="students">Students</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Class</span>
            <select name="class" defaultValue={classId ?? ""} className={cn(selectClass, "w-40")}>
              <option value="">Choose a class</option>
              {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Layout</span>
            <select name="layout" defaultValue={layout} className={cn(selectClass, "w-56")}>
              <option value="a4">A4 sheets (10 per page)</option>
              <option value="printer">Card printer (1 per page)</option>
            </select>
          </label>
          <Button type="submit" variant="outline">Show cards</Button>
        </form>

        {noPhoto > 0 && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> {noPhoto} of {people.length} have no photo yet, so their card shows initials.
            {who === "students" && classId && <Link href={`/students?class=${classId}`} className="font-medium underline">Add photos</Link>}
          </p>
        )}
        {people.length === 0 && (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {who === "students" && !classId ? "Choose a class to print its cards." : "Nobody to print."}
          </p>
        )}
        {people.length > 0 && <p className="mb-3 text-sm text-muted-foreground">{people.length} card{people.length === 1 ? "" : "s"} · <Link href={href({ layout: layout === "a4" ? "printer" : "a4" })} className="text-brand hover:underline">switch to {layout === "a4" ? "card printer" : "A4"} layout</Link></p>}
      </div>

      {layout === "a4" ? (
        <div className="grid grid-cols-[repeat(auto-fill,85.6mm)] justify-center gap-[4mm] print:grid-cols-[85.6mm_85.6mm] print:gap-x-[6mm] print:gap-y-[3mm]">
          {people.map((p) => <IdCard key={p.id} person={p} school={schoolInfo} />)}
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-4 print:block">
          {people.map((p) => <div key={p.id} className="card-page"><IdCard person={p} school={schoolInfo} /></div>)}
        </div>
      )}
    </>
  );
}
