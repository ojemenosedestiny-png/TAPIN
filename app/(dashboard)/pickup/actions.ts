"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, idSchema } from "@/lib/validation";
import { normaliseNgPhone } from "@/lib/phone";
import { normaliseUid } from "@/lib/nfc";
import { QR_CODE_PREFIX, QR_PASS_PREFIX, hashPickupCode, hashQrToken, newPickupCode, newQrToken } from "@/lib/pickup";
import { localDate } from "@/lib/time";
import { processOutbox } from "@/lib/alerts";
import { PHOTO_BUCKET, pathInSchool } from "@/lib/photos";
import type { ActionState } from "@/components/forms/field";

const personSchema = z.object({
  name: z.string().trim().min(2, "Enter their full name.").max(120),
  relationship: z.string().trim().max(40).optional().transform((v) => v || null),
  phone: z.string().trim().max(20).optional(),
  student_ids: z.array(idSchema).min(1, "Choose at least one child.").max(20),
});

async function studentsInSchool(db: ReturnType<typeof createAdminClient>, schoolId: string, ids: string[]) {
  const { data } = await db.from("students").select("id").eq("school_id", schoolId).in("id", ids);
  return (data ?? []).map((s) => s.id as string);
}

function readPerson(fd: FormData) {
  return personSchema.safeParse({ ...Object.fromEntries(fd), student_ids: fd.getAll("student_ids").map(String) });
}

/** Adds someone who may collect children. Active straight away when the parent has approved them. */
export async function savePickupPerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = readPerson(fd);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const phone = v.phone ? normaliseNgPhone(v.phone) : null;
  if (v.phone && !phone) return { errors: { phone: "Enter a Nigerian phone number, e.g. 0803 123 4567." } };
  const id = fd.get("id") ? idSchema.safeParse(fd.get("id")) : null;
  if (id && !id.success) return { errors: { _form: "Invalid person." } };

  const db = createAdminClient();
  const kids = await studentsInSchool(db, user.schoolId, v.student_ids);
  if (!kids.length) return { errors: { student_ids: "Choose at least one child." } };

  let personId: string;
  if (id?.success) {
    const { data, error } = await db.from("pickup_people").update({ name: v.name, relationship: v.relationship, phone, updated_at: new Date().toISOString() })
      .eq("id", id.data).eq("school_id", user.schoolId).select("id").maybeSingle();
    if (error || !data) return { errors: { _form: "Could not save. Please try again." } };
    personId = data.id;
    await db.from("pickup_people_students").delete().eq("person_id", personId).not("student_id", "in", `(${kids.join(",")})`);
  } else {
    const approved = fd.get("approved") === "on";
    const { data, error } = await db.from("pickup_people").insert({
      school_id: user.schoolId, name: v.name, relationship: v.relationship, phone, status: approved ? "active" : "pending", added_by: "school",
    }).select("id").single();
    if (error || !data) return { errors: { _form: "Could not add this person." } };
    personId = data.id;
  }
  const { error: linkErr } = await db.from("pickup_people_students")
    .upsert(kids.map((sid) => ({ person_id: personId, student_id: sid, school_id: user.schoolId })), { onConflict: "person_id,student_id", ignoreDuplicates: true });
  if (linkErr) return { errors: { _form: "Saved, but the children couldn't be linked. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: id ? "pickup.edit" : "pickup.add", entity: "pickup_people", entityId: personId, details: { name: v.name, children: kids.length } });
  revalidatePath("/pickup");
  return { ok: id ? "Saved." : `${v.name} added. Link a pickup card next.` };
}

const idForm = z.object({ id: idSchema });

/** Approve, revoke or restore a pickup person. */
export async function setPickupStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.extend({ status: z.enum(["active", "revoked"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid request." } };
  const db = createAdminClient();
  const { data } = await db.from("pickup_people").update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id).eq("school_id", user.schoolId).select("name").maybeSingle();
  if (!data) return { errors: { _form: "That person wasn't found." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: `pickup.${parsed.data.status === "active" ? "approve" : "revoke"}`, entity: "pickup_people", entityId: parsed.data.id });
  revalidatePath("/pickup");
  return { ok: parsed.data.status === "active" ? `${data.name} can collect children.` : `${data.name} is no longer allowed. Their card now shows "Not authorised".` };
}

/** Links a pickup card (typed by a USB reader, or read with this phone's NFC). */
export async function linkPickupCard(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.safeParse(Object.fromEntries(fd));
  const uid = normaliseUid(String(fd.get("uid") ?? ""));
  if (!parsed.success) return { errors: { _form: "Invalid person." } };
  if (!uid) return { errors: { uid: "That doesn't look like a card number. Tap the card again." } };
  const db = createAdminClient();
  const { data: used } = await db.from("cards").select("id").eq("uid", uid).maybeSingle();
  if (used) return { errors: { uid: "This card is already a student or staff card. Use a new card." } };
  const { data, error } = await db.from("pickup_people").update({ card_uid: uid, card_blocked: false, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id).eq("school_id", user.schoolId).select("name").maybeSingle();
  if (error?.code === "23505") return { errors: { uid: "This card is already linked to someone. Use a new card." } };
  if (error || !data) return { errors: { _form: "Could not link the card." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "pickup.card", entity: "pickup_people", entityId: parsed.data.id, details: { uid_tail: uid.slice(-4) } });
  revalidatePath("/pickup");
  return { ok: `Card linked to ${data.name}.` };
}

/** Block a lost card (it then shows "Not authorised"), or unblock it. */
export async function setPickupCardBlocked(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.extend({ blocked: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid request." } };
  const blocked = parsed.data.blocked === "1";
  const db = createAdminClient();
  const { data } = await db.from("pickup_people").update({ card_blocked: blocked, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id).eq("school_id", user.schoolId).not("card_uid", "is", null).select("name").maybeSingle();
  if (!data) return { errors: { _form: "No card to change." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: blocked ? "pickup.card_block" : "pickup.card_unblock", entity: "pickup_people", entityId: parsed.data.id });
  revalidatePath("/pickup");
  return { ok: blocked ? `${data.name}'s card is blocked.` : `${data.name}'s card works again.` };
}

export async function deletePickupPerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid person." } };
  const db = createAdminClient();
  const { data } = await db.from("pickup_people").delete().eq("id", parsed.data.id).eq("school_id", user.schoolId).select("name, photo_url").maybeSingle();
  if (!data) return { errors: { _form: "That person wasn't found." } };
  if (data.photo_url && pathInSchool(data.photo_url, user.schoolId)) await db.storage.from(PHOTO_BUCKET).remove([data.photo_url]);
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "pickup.delete", entity: "pickup_people", entityId: parsed.data.id, details: { name: data.name } });
  revalidatePath("/pickup");
  return { ok: `${data.name} removed. The pickup log keeps their name.` };
}

const codeSchema = z.object({
  person_name: z.string().trim().min(2, "Enter who is collecting.").max(120),
  phone: z.string().trim().max(20).optional(),
  day: z.enum(["today", "tomorrow"]),
  student_ids: z.array(idSchema).min(1, "Choose at least one child.").max(20),
});

/** A one-day code for someone collecting once. Shown once; texted to them if a phone is given. */
export async function createPickupCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = codeSchema.safeParse({ ...Object.fromEntries(fd), student_ids: fd.getAll("student_ids").map(String) });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const phone = v.phone ? normaliseNgPhone(v.phone) : null;
  if (v.phone && !phone) return { errors: { phone: "Enter a Nigerian phone number, e.g. 0803 123 4567." } };

  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("name, timezone").eq("id", user.schoolId).single();
  if (!school) return { errors: { _form: "School not found." } };
  const kids = await studentsInSchool(db, user.schoolId, v.student_ids);
  if (!kids.length) return { errors: { student_ids: "Choose at least one child." } };
  const date = new Date(Date.now() + (v.day === "tomorrow" ? 86_400_000 : 0));
  const validDate = localDate(date, school.timezone);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPickupCode();
    const { data, error } = await db.from("pickup_codes").insert({
      school_id: user.schoolId, code_hash: hashPickupCode(user.schoolId, code), person_name: v.person_name, phone, valid_date: validDate, created_by_user_id: user.id,
    }).select("id").single();
    if (error?.code === "23505") continue; // that code is taken today; pick another
    if (error || !data) return { errors: { _form: "Could not create the code." } };
    await db.from("pickup_code_students").insert(kids.map((sid) => ({ code_id: data.id, student_id: sid, school_id: user.schoolId })));
    if (phone) {
      await db.from("sms_logs").insert({
        school_id: user.schoolId, phone, type: "pickup", dedupe_key: `pickup-code:${data.id}`,
        message: `${school.name}: your pickup code for ${v.day} is ${code}. Enter it at the school kiosk. Do not share it.`,
      });
      await processOutbox(db, { limit: 5, schoolId: user.schoolId });
    }
    await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "pickup.code", entity: "pickup_codes", entityId: data.id, details: { person: v.person_name, date: validDate, children: kids.length } });
    revalidatePath("/pickup");
    return { ok: phone ? "Code created and texted." : "Code created.", data: { code, qr: `${QR_CODE_PREFIX}${code}`, person: v.person_name, date: validDate } };
  }
  return { errors: { _form: "Could not create a code. Please try again." } };
}

/** A QR pickup pass for a person (on paper or their phone). A new pass cancels the old one. */
export async function issuePickupQr(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid person." } };
  const token = newQrToken();
  const db = createAdminClient();
  const { data } = await db.from("pickup_people").update({ qr_token_hash: hashQrToken(token), qr_issued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id).eq("school_id", user.schoolId).select("name").maybeSingle();
  if (!data) return { errors: { _form: "That person wasn't found." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "pickup.qr", entity: "pickup_people", entityId: parsed.data.id });
  revalidatePath("/pickup");
  return { ok: "QR pass ready. Print it or send it to them now: it won't be shown again.", data: { qr: `${QR_PASS_PREFIX}${token}`, name: data.name } };
}

export async function cancelPickupCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = idForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid code." } };
  const db = createAdminClient();
  const { data } = await db.from("pickup_codes").delete().eq("id", parsed.data.id).eq("school_id", user.schoolId).is("used_at", null).select("person_name").maybeSingle();
  if (!data) return { errors: { _form: "That code was already used or removed." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "pickup.code_cancel", entity: "pickup_codes", entityId: parsed.data.id });
  revalidatePath("/pickup");
  return { ok: `Code for ${data.person_name} cancelled.` };
}
