"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { excusalSchema, fieldErrors, idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

/** School admin or the student's class teacher (enforced by RLS) marks a day as excused. */
export async function addExcusal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("students");
  const parsed = excusalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("excusals").insert({ ...parsed.data, school_id: user.schoolId, created_by: user.id });
  if (error) {
    if (error.code === "23505") return { errors: { date: "This day is already excused." } };
    return { errors: { _form: "You can only excuse students in your own classes." } };
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "excusal.add", entity: "excusals", entityId: parsed.data.student_id, details: { date: parsed.data.date, reason: parsed.data.reason } });
  revalidatePath("/students");
  return { ok: "Marked as excused. No absence SMS will be sent for that day." };
}

export async function removeExcusal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("students");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid request." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("excusals").delete().eq("id", id.data).select("student_id, date").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not remove it." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "excusal.remove", entity: "excusals", entityId: data.student_id, details: { date: data.date } });
  revalidatePath("/students");
  return { ok: "Excusal removed." };
}
