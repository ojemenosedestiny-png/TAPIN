"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { PHOTO_BUCKET, pathInSchool } from "@/lib/photos";
import { holderTypeSchema, idSchema } from "@/lib/validation";

const setPhotoSchema = z.object({ holder_type: holderTypeSchema.or(z.literal("pickup")), holder_id: idSchema, path: z.string().max(300) });

/**
 * Saves an uploaded photo's storage path on the person, and removes their previous photo.
 * The browser uploads the file itself (storage RLS only lets school admins write into their school's folder).
 */
export async function setPhoto(input: z.infer<typeof setPhotoSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") return { ok: false, error: "Only school admins can change photos." };
  const parsed = setPhotoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid photo." };
  const { holder_type, holder_id, path } = parsed.data;
  if (!pathInSchool(path, user.schoolId) || !path.startsWith(`${user.schoolId}/${holder_type}/${holder_id}-`)) {
    return { ok: false, error: "Invalid photo location." };
  }

  const supabase = await createClient();
  const table = holder_type === "student" ? "students" : holder_type === "pickup" ? "pickup_people" : "staff";
  if (holder_type === "student") {
    const { data: st } = await supabase.from("students").select("consent_at").eq("id", holder_id).maybeSingle();
    if (!st?.consent_at) return { ok: false, error: "Record the parent's consent before adding a photo." };
  }
  const { data: before } = await supabase.from(table).select("photo_url").eq("id", holder_id).maybeSingle();
  const { data, error } = await supabase.from(table).update({ photo_url: path }).eq("id", holder_id).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the photo." };

  if (before?.photo_url && before.photo_url !== path && pathInSchool(before.photo_url, user.schoolId)) {
    await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_url]);
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "photo.set", entity: table, entityId: holder_id });
  revalidatePath(holder_type === "student" ? "/students" : holder_type === "pickup" ? "/pickup" : "/staff");
  return { ok: true };
}

const bulkSchema = z.array(z.object({ admission_no: z.string().min(1).max(40), path: z.string().max(300) })).max(500);

/** Bulk upload: match by admission number. Returns which ones were saved. */
export async function setPhotosByAdmission(items: z.infer<typeof bulkSchema>): Promise<{ saved: string[]; notFound: string[]; noConsent?: string[]; error?: string }> {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") return { saved: [], notFound: [], error: "Only school admins can change photos." };
  const parsed = bulkSchema.safeParse(items);
  if (!parsed.success) return { saved: [], notFound: [], error: "Invalid upload." };

  const supabase = await createClient();
  const nos = parsed.data.map((i) => i.admission_no.toUpperCase());
  const { data: students } = await supabase.from("students").select("id, admission_no, photo_url, consent_at").in("admission_no", nos);
  const byNo = new Map((students ?? []).map((s) => [s.admission_no.toUpperCase(), s]));

  const saved: string[] = [];
  const notFound: string[] = [];
  const noConsent: string[] = [];
  const toRemove: string[] = [];
  for (const item of parsed.data) {
    const s = byNo.get(item.admission_no.toUpperCase());
    if (!s || !item.path.startsWith(`${user.schoolId}/student/${s.id}-`)) {
      notFound.push(item.admission_no);
      if (pathInSchool(item.path, user.schoolId)) toRemove.push(item.path); // orphan upload
      continue;
    }
    if (!s.consent_at) {
      noConsent.push(item.admission_no);
      if (pathInSchool(item.path, user.schoolId)) toRemove.push(item.path);
      continue;
    }
    const { error } = await supabase.from("students").update({ photo_url: item.path }).eq("id", s.id);
    if (error) { notFound.push(item.admission_no); continue; }
    if (s.photo_url && s.photo_url !== item.path && pathInSchool(s.photo_url, user.schoolId)) toRemove.push(s.photo_url);
    saved.push(item.admission_no);
  }
  if (toRemove.length) await supabase.storage.from(PHOTO_BUCKET).remove(toRemove);
  if (saved.length) {
    await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "photo.bulk_set", entity: "students", details: { count: saved.length } });
  }
  revalidatePath("/students");
  return { saved, notFound, noConsent };
}

/** For bulk upload: the student ids for a list of admission numbers (to build upload paths). */
export async function lookupAdmissions(nos: string[]): Promise<Record<string, string>> {
  await requireSchoolArea("students");
  const clean = z.array(z.string().min(1).max(40)).max(500).safeParse(nos);
  if (!clean.success) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("students").select("id, admission_no").in("admission_no", clean.data.map((n) => n.toUpperCase()));
  return Object.fromEntries((data ?? []).map((s) => [s.admission_no.toUpperCase(), s.id]));
}
