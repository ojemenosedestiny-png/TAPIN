import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CreditCard, Printer, Trash2 } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { ClassDialog } from "./class-dialog";
import { deleteClass } from "./actions";

export const metadata: Metadata = { title: "Classes" };

export default async function ClassesPage() {
  const user = await requireSchoolArea("classes");
  const supabase = await createClient();
  const [{ data: classes }, { data: teachers }, { data: students }] = await Promise.all([
    supabase.from("classes").select("id, name, class_teacher_id").order("name"),
    supabase.from("users").select("id, name").eq("school_id", user.schoolId).eq("role", "teacher").order("name"),
    supabase.from("students").select("class_id").eq("status", "active"),
  ]);

  const teacherName = new Map((teachers ?? []).map((t) => [t.id, t.name]));
  const counts = new Map<string, number>();
  for (const s of students ?? []) if (s.class_id) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
  const list = classes ?? [];

  return (
    <>
      <PageHeader title="Classes" description={`${list.length} class${list.length === 1 ? "" : "es"}`}>
        <ClassDialog teachers={teachers ?? []} />
      </PageHeader>

      {list.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-7" aria-hidden />}
          title="No classes yet"
          body="Create your classes (e.g. JSS1A, JSS1B) before adding students — or import students from Excel and classes are created for you."
          action={<ClassDialog teachers={teachers ?? []} />}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Class</th>
                <th scope="col" className="px-4 py-3 font-medium">Class teacher</th>
                <th scope="col" className="px-4 py-3 font-medium">Students</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/students?class=${c.id}`} className="hover:underline">{c.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.class_teacher_id ? teacherName.get(c.class_teacher_id) ?? "—" : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{counts.get(c.id) ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/enroll/class/${c.id}`}><CreditCard className="size-4" /> Enrol cards</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/cards/print?class=${c.id}`}><Printer className="size-4" /> Print cards</Link>
                      </Button>
                      <ClassDialog teachers={teachers ?? []} existing={c} />
                      <ConfirmAction
                        action={deleteClass}
                        fields={{ id: c.id }}
                        title={`Delete ${c.name}?`}
                        description="Only empty classes can be deleted. This can't be undone."
                        confirmLabel="Delete class"
                        trigger={<Button variant="ghost" size="sm" aria-label={`Delete ${c.name}`}><Trash2 className="size-4" /></Button>}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
