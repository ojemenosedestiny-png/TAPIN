import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatNgPhone } from "@/lib/phone";
import { DEFAULT_RULES } from "@/lib/lessons";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { AddAssignmentForm, AddSubjectForm, LessonSettingsForm, type LessonSettingsValues } from "../forms";
import { deleteSubject, removeAssignment } from "../actions";

export const metadata: Metadata = { title: "Lesson setup" };

type Assignment = { id: string; staff_id: string; classes: { name: string } | null; subjects: { name: string } | null };

export default async function LessonSetupPage() {
  await requireSchoolArea("lessons");
  const supabase = await createClient();
  const [{ data: settings }, { data: subjects }, { data: classes }, { data: staff }, { data: assigned }] = await Promise.all([
    supabase.from("lesson_settings").select("*").maybeSingle(),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("classes").select("id, name").order("name"),
    supabase.from("staff").select("id, name").eq("status", "active").order("name"),
    supabase.from("teacher_assignments").select("id, staff_id, classes(name), subjects(name)"),
  ]);

  const values: LessonSettingsValues = {
    enabled: settings?.enabled ?? false,
    min_minutes: settings?.min_minutes ?? DEFAULT_RULES.minMinutes,
    max_minutes: settings?.max_minutes ?? DEFAULT_RULES.maxMinutes,
    autoclose_time: (settings?.autoclose_time ?? "17:00").slice(0, 5),
    director_phone: settings?.director_phone ? formatNgPhone(settings.director_phone) : "",
    director_alerts: settings?.director_alerts ?? "off",
    director_summary_time: (settings?.director_summary_time ?? "17:30").slice(0, 5),
  };
  const byTeacher = new Map<string, Assignment[]>();
  for (const a of (assigned ?? []) as unknown as Assignment[]) byTeacher.set(a.staff_id, [...(byTeacher.get(a.staff_id) ?? []), a]);
  const teachersWithWork = (staff ?? []).filter((s) => byTeacher.has(s.id));

  return (
    <>
      <PageHeader title="Lesson setup" description="Turn on the lesson check, set the rules, and tell the kiosk who teaches what.">
        <Button asChild variant="outline"><Link href="/lessons"><ArrowLeft className="size-4" aria-hidden /> Lessons</Link></Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="surface rounded-2xl p-5 sm:p-6" aria-labelledby="rules-h">
          <h2 id="rules-h" className="text-lg font-semibold text-ink">Rules and alerts</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Lessons outside these lengths are flagged on the dashboard and in reports.</p>
          <LessonSettingsForm values={values} />
        </section>

        <section className="surface rounded-2xl p-5 sm:p-6" aria-labelledby="subjects-h">
          <h2 id="subjects-h" className="text-lg font-semibold text-ink">Subjects</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">What teachers choose from at the kiosk.</p>
          <AddSubjectForm />
          {(subjects ?? []).length > 0 ? (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {(subjects ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{s.name}</span>
                  <ConfirmDelete action={deleteSubject} id={s.id} label={`Remove ${s.name}`} variant="ghost" title={`Remove ${s.name}?`}
                    body={<p>It disappears from the kiosk and from every teacher&apos;s timetable. Lessons already taught keep the subject name.</p>} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No subjects yet. Add the ones your school teaches.</p>
          )}
        </section>
      </div>

      <section className="surface mt-6 rounded-2xl p-5 sm:p-6" aria-labelledby="timetable-h">
        <h2 id="timetable-h" className="text-lg font-semibold text-ink">Who teaches what</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">The kiosk shows these first when a teacher starts a lesson. They can still pick any class and subject.</p>
        <AddAssignmentForm staff={staff ?? []} classes={classes ?? []} subjects={subjects ?? []} />
        {teachersWithWork.length > 0 && (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teachersWithWork.map((t) => (
              <li key={t.id} className="rounded-xl border border-border p-4">
                <p className="font-medium text-ink">{t.name}</p>
                <ul className="mt-2 space-y-1">
                  {(byTeacher.get(t.id) ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground"><span className="text-ink">{a.classes?.name}</span> · {a.subjects?.name}</span>
                      <ConfirmDelete action={removeAssignment} id={a.id} label={`Remove ${a.classes?.name} ${a.subjects?.name} from ${t.name}`} variant="ghost"
                        title="Remove from timetable?" body={<p>{t.name} won&apos;t see {a.classes?.name} {a.subjects?.name} first at the kiosk any more.</p>} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
