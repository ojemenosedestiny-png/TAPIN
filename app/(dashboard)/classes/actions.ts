"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { classSchema, fieldErrors, idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

async function teacherBelongsToSchool(supabase: Awaited<ReturnType<typeof createClient>>, teacherId: string | null, schoolId: string) {
  if (!teacherId) return true;
  const { data } = await supabase.from("users").select("id").eq("id", teacherId).eq("school_id", schoolId).eq("role", "teacher").maybeSingle();
  return !!data;
}

export async function saveClass(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("classes");
  const id = formData.get("id");
  const parsed = classSchema.safeParse({ name: formData.get("name"), class_teacher_id: formData.get("class_teacher_id") || undefined });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  if (!(await teacherBelongsToSchool(supabase, parsed.data.class_teacher_id, user.schoolId))) {
    return { errors: { class_teacher_id: "Choose a teacher from your school." } };
  }

  const isEdit = typeof id === "string" && id.length > 0;
  if (isEdit && !idSchema.safeParse(id).success) return { errors: { _form: "Invalid class." } };

  const query = isEdit
    ? supabase.from("classes").update(parsed.data).eq("id", id).select("id, name").single()
    : supabase.from("classes").insert({ ...parsed.data, school_id: user.schoolId }).select("id, name").single();
  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return { errors: { name: `There is already a class called ${parsed.data.name}.` } };
    return { errors: { _form: "Could not save the class. Please try again." } };
  }

  await writeAudit({
    schoolId: user.schoolId, actorId: user.id, action: isEdit ? "class.update" : "class.create", entity: "classes", entityId: data.id,
    details: parsed.data,
  });
  revalidatePath("/classes");
  return { ok: isEdit ? `${data.name} updated.` : `${data.name} created.` };
}

export async function deleteClass(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("classes");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid class." } };

  const supabase = await createClient();
  const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("class_id", id.data);
  if (count) return { errors: { _form: `Move the ${count} student${count === 1 ? "" : "s"} in this class to another class first.` } };

  const { data, error } = await supabase.from("classes").delete().eq("id", id.data).select("name").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not delete the class." } };

  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "class.delete", entity: "classes", entityId: id.data, details: { name: data.name } });
  revalidatePath("/classes");
  return { ok: `${data.name} deleted.` };
}
