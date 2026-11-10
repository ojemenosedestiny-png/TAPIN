"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { normaliseNgPhone } from "@/lib/phone";
import { fieldErrors, guardianSchema, idSchema, studentSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

async function adminOnly() {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") throw new Error("Only school admins can change student records.");
  return user;
}

async function classInSchool(supabase: Awaited<ReturnType<typeof createClient>>, classId: string | null) {
  if (!classId) return true;
  const { data } = await supabase.from("classes").select("id").eq("id", classId).maybeSingle(); // RLS: own school only
  return !!data;
}

export async function saveStudent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await adminOnly();
  const id = formData.get("id");
  const parsed = studentSchema.safeParse({
    admission_no: formData.get("admission_no"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    class_id: formData.get("class_id") || undefined,
    status: formData.get("status") || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  if (!(await classInSchool(supabase, parsed.data.class_id))) return { errors: { class_id: "Choose a class from your school." } };

  const isEdit = typeof id === "string" && id.length > 0;
  if (isEdit && !idSchema.safeParse(id).success) return { errors: { _form: "Invalid student." } };

  const { data, error } = isEdit
    ? await supabase.from("students").update(parsed.data).eq("id", id).select("id").single()
    : await supabase.from("students").insert({ ...parsed.data, school_id: user.schoolId }).select("id").single();
  if (error) {
    if (error.code === "23505") return { errors: { admission_no: `Admission number ${parsed.data.admission_no} is already used.` } };
    return { errors: { _form: "Could not save the student. Please try again." } };
  }

  // Leaving school: block their card so it stops working at the gate.
  if (isEdit && parsed.data.status !== "active") {
    const { data: card } = await supabase.from("cards").select("id").eq("holder_type", "student").eq("holder_id", data.id).eq("status", "active").maybeSingle();
    if (card) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      await createAdminClient().rpc("set_card_status", { p_school_id: user.schoolId, p_actor_id: user.id, p_card_id: card.id, p_status: "blocked" });
    }
  }

  await writeAudit({
    schoolId: user.schoolId, actorId: user.id, action: isEdit ? "student.update" : "student.create", entity: "students", entityId: data.id,
    details: { admission_no: parsed.data.admission_no, status: parsed.data.status, class_id: parsed.data.class_id },
  });
  revalidatePath("/students");
  const name = `${parsed.data.first_name} ${parsed.data.last_name}`;
  return { ok: isEdit ? `${name} updated.` : `${name} added.`, data: { id: data.id } };
}

export async function addGuardian(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await adminOnly();
  const studentId = idSchema.safeParse(formData.get("student_id"));
  if (!studentId.success) return { errors: { _form: "Invalid student." } };
  const parsed = guardianSchema.safeParse({
    name: formData.get("name"), phone: formData.get("phone"), relationship: formData.get("relationship") || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const phone = normaliseNgPhone(parsed.data.phone);
  if (!phone) return { errors: { phone: "Enter a Nigerian mobile number, e.g. 0803 123 4567." } };

  const supabase = await createClient();
  const { data: student } = await supabase.from("students").select("id").eq("id", studentId.data).maybeSingle();
  if (!student) return { errors: { _form: "Student not found." } };

  const { count } = await supabase.from("student_guardians").select("guardian_id", { count: "exact", head: true }).eq("student_id", student.id);
  if ((count ?? 0) >= 4) return { errors: { _form: "A student can have at most 4 guardians." } };

  // Reuse the guardian if this phone number is already on file (siblings share parents).
  let { data: guardian } = await supabase.from("guardians").select("id, name").eq("phone", phone).maybeSingle();
  if (!guardian) {
    const ins = await supabase.from("guardians")
      .insert({ school_id: user.schoolId, name: parsed.data.name, phone, relationship: parsed.data.relationship })
      .select("id, name").single();
    if (ins.error) return { errors: { _form: "Could not save the guardian." } };
    guardian = ins.data;
  }

  const link = await supabase.from("student_guardians").insert({ school_id: user.schoolId, student_id: student.id, guardian_id: guardian.id });
  if (link.error) {
    if (link.error.code === "23505") return { errors: { phone: "This guardian is already linked to the student." } };
    return { errors: { _form: "Could not link the guardian." } };
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "guardian.link", entity: "student_guardians", entityId: student.id, details: { guardian_id: guardian.id } });
  revalidatePath("/students");
  return { ok: `${guardian.name} added.` };
}

export async function unlinkGuardian(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await adminOnly();
  const studentId = idSchema.safeParse(formData.get("student_id"));
  const guardianId = idSchema.safeParse(formData.get("guardian_id"));
  if (!studentId.success || !guardianId.success) return { errors: { _form: "Invalid request." } };

  const supabase = await createClient();
  const { error } = await supabase.from("student_guardians").delete().eq("student_id", studentId.data).eq("guardian_id", guardianId.data);
  if (error) return { errors: { _form: "Could not remove the guardian." } };

  // Delete the guardian record entirely if no other child uses it (keep only what's needed).
  const { count } = await supabase.from("student_guardians").select("student_id", { count: "exact", head: true }).eq("guardian_id", guardianId.data);
  if (!count) await supabase.from("guardians").delete().eq("id", guardianId.data);

  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "guardian.unlink", entity: "student_guardians", entityId: studentId.data, details: { guardian_id: guardianId.data } });
  revalidatePath("/students");
  return { ok: "Guardian removed." };
}
