import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileSpreadsheet, GraduationCap, Images } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { formatNgPhone } from "@/lib/phone";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { PersonAvatar } from "@/components/dashboard/person-avatar";
import { CardPill, type CardState } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { StudentFilters } from "./student-filters";
import { StudentDialog } from "./student-dialog";
import { StudentDrawer, DrawerLoading } from "./student-drawer";

export const metadata: Metadata = { title: "Students" };

const PAGE_SIZE = 50;
const CARD_FILTERS = ["none", "active", "verified", "blocked"] as const;

type Search = { q?: string; class?: string; card?: string; consent?: string; page?: string; student?: string };

/** Keep search text safe for a PostgREST or() filter. */
function cleanQuery(q: string | undefined) {
  return (q ?? "").replace(/[^\p{L}\p{N}\s'\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireSchoolArea("students");
  const isAdmin = user.role === "school_admin";
  const supabase = await createClient();

  const q = cleanQuery(sp.q);
  const classId = sp.class && /^[0-9a-f-]{36}$/i.test(sp.class) ? sp.class : undefined;
  const card = CARD_FILTERS.includes(sp.card as (typeof CARD_FILTERS)[number]) ? sp.card : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let query = supabase
    .from("student_overview")
    .select("id, admission_no, full_name, class_name, photo_url, status, card_state, guardian_phone, consent_at", { count: "exact" })
    .eq("status", "active")
    .order("last_name")
    .order("first_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%,last_name.ilike.%${q}%`);
  if (classId) query = query.eq("class_id", classId);
  if (card) query = query.eq("card_state", card);
  const consentPending = sp.consent === "pending";
  if (consentPending) query = query.is("consent_at", null);

  const [{ data: rows, count, error }, { data: classes }] = await Promise.all([
    query,
    supabase.from("classes").select("id, name").order("name"),
  ]);
  if (error) throw new Error("Could not load students.");

  const photos = await signPhotos(supabase, (rows ?? []).map((r) => r.photo_url));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!(q || classId || card || consentPending);

  const hrefWith = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, class: sp.class, card: sp.card, consent: sp.consent, page: sp.page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/students?${s}` : "/students";
  };

  return (
    <>
      <PageHeader title="Students" description={`${total} ${filtered ? "matching" : "active"} student${total === 1 ? "" : "s"}`}>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/students/photos"><Images className="size-4" /> Bulk photos</Link></Button>
            <Button asChild variant="outline"><Link href="/students/import"><FileSpreadsheet className="size-4" /> Import Excel</Link></Button>
            <StudentDialog classes={classes ?? []} />
          </div>
        )}
      </PageHeader>

      <StudentFilters classes={classes ?? []} q={sp.q ?? ""} classId={classId ?? ""} card={card ?? ""} consent={consentPending ? "pending" : ""} isAdmin={isAdmin} />

      {(rows ?? []).length === 0 ? (
        filtered ? (
          <EmptyState icon={<GraduationCap className="size-7" aria-hidden />} title="No students match" body="Try a different name, class or card filter."
            action={<Button asChild variant="outline"><Link href="/students">Clear filters</Link></Button>} />
        ) : (
          <EmptyState icon={<GraduationCap className="size-7" aria-hidden />} title="No students yet"
            body={isAdmin ? "Import your class lists from Excel, or add students one at a time." : "Students in your classes will appear here."}
            action={isAdmin ? <Button asChild><Link href="/students/import"><FileSpreadsheet className="size-4" /> Import from Excel</Link></Button> : undefined} />
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Student</th>
                <th scope="col" className="px-4 py-3 font-medium">Class</th>
                <th scope="col" className="px-4 py-3 font-medium">Card</th>
                {isAdmin && <th scope="col" className="px-4 py-3 font-medium">Guardian phone</th>}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((s) => (
                <tr key={s.id} className="group relative border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={hrefWith({ student: s.id })} scroll={false} className="flex items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none group-focus-within:underline">
                      <PersonAvatar name={s.full_name} src={s.photo_url ? photos.get(s.photo_url) : null} />
                      <span>
                        <span className="block font-medium text-ink">{s.full_name}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{s.admission_no}{isAdmin && !s.consent_at && <span className="ml-2 rounded bg-amber-50 px-1.5 py-px font-sans text-[11px] font-medium text-amber-900">No consent</span>}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.class_name ?? "—"}</td>
                  <td className="px-4 py-2.5">{isAdmin ? <CardPill state={s.card_state as CardState} /> : "—"}</td>
                  {isAdmin && <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.guardian_phone ? formatNgPhone(s.guardian_phone) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
              <Link href={hrefWith({ page: String(page - 1) })}>Previous</Link>
            </Button>
            <Button asChild variant="outline" size="sm" aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
              <Link href={hrefWith({ page: String(page + 1) })}>Next</Link>
            </Button>
          </div>
        </nav>
      )}

      {sp.student && /^[0-9a-f-]{36}$/i.test(sp.student) && (
        <Suspense fallback={<DrawerLoading closeHref={hrefWith({ student: undefined })} />}>
          <StudentDrawer studentId={sp.student} closeHref={hrefWith({ student: undefined })} user={user} classes={classes ?? []} />
        </Suspense>
      )}
    </>
  );
}
