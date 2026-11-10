import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Enrol cards" };

export default async function EnrollPage() {
  await requireSchoolArea("enroll");
  const supabase = await createClient();
  const [{ data: classes }, { data: students }] = await Promise.all([
    supabase.from("classes").select("id, name").order("name"),
    supabase.from("student_overview").select("class_id, card_state").eq("status", "active"),
  ]);

  const stats = new Map<string, { total: number; without: number }>();
  for (const s of students ?? []) {
    if (!s.class_id) continue;
    const st = stats.get(s.class_id) ?? { total: 0, without: 0 };
    st.total++;
    if (s.card_state === "none" || s.card_state === "replaced" || s.card_state === "blocked") st.without++;
    stats.set(s.class_id, st);
  }

  return (
    <>
      <PageHeader title="Enrol cards" description="Pick a class to link cards to every student quickly. To enrol one person, open their profile and choose Assign card." />
      {(classes ?? []).length === 0 ? (
        <EmptyState icon={<BookOpen className="size-7" aria-hidden />} title="No classes yet" body="Create classes and add students first."
          action={<Button asChild><Link href="/classes">Go to classes</Link></Button>} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(classes ?? []).map((c) => {
            const st = stats.get(c.id) ?? { total: 0, without: 0 };
            const pct = st.total ? Math.round(((st.total - st.without) / st.total) * 100) : 0;
            return (
              <li key={c.id}>
                <Link href={`/enroll/class/${c.id}`} className="group flex items-center gap-4 surface rounded-xl p-4 shadow-sm transition hover:border-brand/40 hover:shadow focus-visible:outline-2 focus-visible:outline-warn">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{c.name}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">{st.without} of {st.total} without a card</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} enrolled`}>
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground group-hover:text-brand" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
