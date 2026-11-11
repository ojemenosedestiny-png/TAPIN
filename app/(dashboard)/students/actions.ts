"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { normaliseNgPhone } from "@/lib/phone";
import { fieldErrors, guardianSchema, idSchema, studentSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "@/lib/photos";

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

/** School admin sets how a guardian receives alerts (SMS or WhatsApp). */
export async function setGuardianChannel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await adminOnly();
  const id = idSchema.safeParse(formData.get("guardian_id"));
  const channel = formData.get("channel");
  if (!id.success || (channel !== "sms" && channel !== "whatsapp")) return { errors: { _form: "Invalid request." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("guardians").update({ channel }).eq("id", id.data).select("name").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not update." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "guardian.channel", entity: "guardians", entityId: id.data, details: { channel } });
  revalidatePath("/students");
  return { ok: `${data.name} will get alerts by ${channel === "whatsapp" ? "WhatsApp" : "text message"}.` };
}

/**
 * Deletes a student added by mistake (a duplicate, a wrong entry), with their attendance, cards and messages.
 * For a pupil who has left, set the status to Withdrawn instead: that keeps the history.
 */
export async function deleteStudent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") return { errors: { _form: "Only school admins can delete students." } };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid student." } };
  const supabase = await createClient(); // RLS: only this school's students are visible
  const { data: s } = await supabase.from("students").select("id, first_name, last_name, admission_no, photo_url").eq("id", id.data).maybeSingle();
  if (!s) return { errors: { _form: "That student wasn't found." } };
  const db = createAdminClient();
  const { count: payments } = await db.from("parent_payments").select("id", { count: "exact", head: true }).eq("student_id", s.id);
  if (payments) return { errors: { _form: "This student has payments on record, so they can't be deleted. Set their status to Withdrawn instead." } };
  const { error } = await db.rpc("delete_student_records", { p_ids: [s.id] });
  if (error) return { errors: { _form: "Could not delete the student. Please try again." } };
  if (s.photo_url) await db.storage.from(PHOTO_BUCKET).remove([s.photo_url]).catch(() => {});
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "student.delete", entity: "students", entityId: s.id, details: { admission_no: s.admission_no } });
  revalidatePath("/students");
  revalidatePath("/today");
  return { ok: `${s.first_name} ${s.last_name} was deleted.` };
}
