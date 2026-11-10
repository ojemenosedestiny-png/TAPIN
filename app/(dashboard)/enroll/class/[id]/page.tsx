import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signPhotos } from "@/lib/photos";
import { ClassEnroll } from "./class-enroll";

export const metadata: Metadata = { title: "Class enrollment" };

export default async function ClassEnrollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSchoolArea("enroll");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: cls } = await supabase.from("classes").select("id, name").eq("id", id).maybeSingle();
  if (!cls) notFound();

  // Students without an active card, in register order.
  const { data: students } = await supabase
    .from("student_overview")
    .select("id, full_name, admission_no, photo_url, card_state")
    .eq("class_id", id)
    .eq("status", "active")
    .in("card_state", ["none", "replaced", "blocked"])
    .order("last_name")
    .order("first_name");

  const photos = await signPhotos(supabase, (students ?? []).map((s) => s.photo_url));

  return (
    <>
      <Link href="/enroll" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink print:hidden"><ArrowLeft className="size-4" /> All classes</Link>
      <ClassEnroll
        className={cls.name}
        classId={cls.id}
        students={(students ?? []).map((s) => ({
          id: s.id, name: s.full_name, admissionNo: s.admission_no, photoUrl: s.photo_url ? photos.get(s.photo_url) ?? null : null,
        }))}
      />
    </>
  );
}
