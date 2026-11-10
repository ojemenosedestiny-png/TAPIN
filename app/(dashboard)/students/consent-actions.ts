"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { PHOTO_BUCKET, pathInSchool } from "@/lib/photos";
import { consentSchema, fieldErrors, idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

/** Records that a parent gave written consent (build plan §6: before collecting a child's data and photo). */
export async function recordConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") return { errors: { _form: "Only school admins can record consent." } };
  const parsed = consentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("students")
    .update({ consent_at: new Date(`${parsed.data.date}T12:00:00Z`).toISOString(), consent_note: parsed.data.note, consent_recorded_by: user.id })
    .eq("id", parsed.data.student_id).select("id").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not save consent." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "consent.record", entity: "students", entityId: data.id, details: { date: parsed.data.date } });
  revalidatePath("/students");
  return { ok: "Consent recorded. You can now add a photo." };
}

/** A parent withdraws consent: the photo is deleted at once and no new one can be added. */
export async function withdrawConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") return { errors: { _form: "Only school admins can change consent." } };
  const id = idSchema.safeParse(formData.get("student_id"));
  if (!id.success) return { errors: { _form: "Invalid student." } };
  const supabase = await createClient();
  const { data: s } = await supabase.from("students").select("photo_url").eq("id", id.data).maybeSingle();
  if (!s) return { errors: { _form: "Student not found." } };
  if (s.photo_url && pathInSchool(s.photo_url, user.schoolId)) await supabase.storage.from(PHOTO_BUCKET).remove([s.photo_url]);
  const { error } = await supabase.from("students")
    .update({ consent_at: null, consent_note: null, consent_recorded_by: null, photo_url: null }).eq("id", id.data);
  if (error) return { errors: { _form: "Could not update consent." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "consent.withdraw", entity: "students", entityId: id.data, details: { photo_deleted: !!s.photo_url } });
  revalidatePath("/students");
  return { ok: "Consent withdrawn and the photo deleted." };
}
