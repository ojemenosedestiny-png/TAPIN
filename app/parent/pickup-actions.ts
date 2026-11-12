"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { normaliseNgPhone } from "@/lib/phone";
import { QR_CODE_PREFIX, QR_PASS_PREFIX, hashPickupCode, hashQrToken, newPickupCode, newQrToken } from "@/lib/pickup";
import { localDate } from "@/lib/time";
import { processOutbox } from "@/lib/alerts";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";

export type ParentPickupState = { ok?: string; error?: string; code?: { code: string; qr: string; person: string; date: string }; pass?: { qr: string; name: string } };

type Mine = { guardianIds: string[]; students: { id: string; school_id: string; guardian_id: string }[]; userId: string };

/** The signed-in parent's own children, as proven by the database (parent_children uses their verified phone). */
async function myChildren(): Promise<Mine | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.rpc("parent_children");
  const kids = (data ?? []) as { student_id: string; guardian_id: string }[];
  if (!kids.length) return null;
  const { data: rows } = await createAdminClient().from("students").select("id, school_id").in("id", kids.map((k) => k.student_id));
  const schoolOf = new Map((rows ?? []).map((r) => [r.id as string, r.school_id as string]));
  return {
    userId: auth.user.id,
    guardianIds: [...new Set(kids.map((k) => k.guardian_id))],
    students: kids.filter((k) => schoolOf.has(k.student_id)).map((k) => ({ id: k.student_id, guardian_id: k.guardian_id, school_id: schoolOf.get(k.student_id)! })),
  };
}

const addSchema = z.object({
  name: z.string().trim().min(2, "Enter their full name.").max(120),
  relationship: z.string().trim().max(40).optional().transform((v) => v || null),
  phone: z.string().trim().max(20).optional(),
  student_ids: z.array(idSchema).min(1, "Choose at least one child.").max(20),
});

/** A parent adds someone who may collect their children. Allowed straight away (the parent is the one approving). */
export async function parentAddPickupPerson(_prev: ParentPickupState, fd: FormData): Promise<ParentPickupState> {
  const me = await myChildren();
  if (!me) return { error: "Please sign in again." };
  if (!(await checkRateLimitShared(`parent-pickup:${me.userId}`, { max: 20, windowMs: 60 * 60_000 })).ok) return { error: "Too many changes. Try again later." };
  const parsed = addSchema.safeParse({ ...Object.fromEntries(fd), student_ids: fd.getAll("student_ids").map(String) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const phone = v.phone ? normaliseNgPhone(v.phone) : null;
  if (v.phone && !phone) return { error: "Enter a Nigerian phone number, e.g. 0803 123 4567." };
  const kids = me.students.filter((s) => v.student_ids.includes(s.id));
  if (!kids.length) return { error: "Choose at least one of your children." };

  const db = createAdminClient();
  // One person per school (siblings at different schools get one record each).
  for (const schoolId of [...new Set(kids.map((k) => k.school_id))]) {
    const here = kids.filter((k) => k.school_id === schoolId);
    const { data: person, error } = await db.from("pickup_people").insert({
      school_id: schoolId, name: v.name, relationship: v.relationship, phone, status: "active", added_by: "parent",
      added_by_guardian_id: here[0]!.guardian_id, approved_by_guardian_id: here[0]!.guardian_id,
    }).select("id").single();
    if (error || !person) return { error: "Could not add this person. Please try again." };
    await db.from("pickup_people_students").insert(here.map((k) => ({ person_id: person.id, student_id: k.id, school_id: schoolId })));
    await writeAudit({ schoolId, actorId: null, action: "pickup.parent_add", entity: "pickup_people", entityId: person.id, details: { name: v.name, guardian: here[0]!.guardian_id } });
  }
  revalidatePath("/parent");
  return { ok: `${v.name} can now collect. Ask the school to give them a pickup card, or send them a one-day code.` };
}

/** Approve someone the school added, for this parent's children. */
export async function parentApprovePickup(personId: string): Promise<ParentPickupState> {
  const me = await myChildren();
  if (!me || !idSchema.safeParse(personId).success) return { error: "Please sign in again." };
  const db = createAdminClient();
  const { data: links } = await db.from("pickup_people_students").select("student_id").eq("person_id", personId);
  const mine = me.students.find((s) => (links ?? []).some((l) => l.student_id === s.id));
  if (!mine) return { error: "This person isn't linked to your children." };
  const { data } = await db.from("pickup_people").update({ status: "active", approved_by_guardian_id: mine.guardian_id, updated_at: new Date().toISOString() })
    .eq("id", personId).eq("status", "pending").select("name, school_id").maybeSingle();
  if (!data) return { error: "Already approved, or no longer waiting." };
  await writeAudit({ schoolId: data.school_id, actorId: null, action: "pickup.parent_approve", entity: "pickup_people", entityId: personId, details: { guardian: mine.guardian_id } });
  revalidatePath("/parent");
  return { ok: `${data.name} approved.` };
}

/** A QR pickup pass for someone allowed to collect this parent's children. A new pass cancels the old one. */
export async function parentIssueQr(personId: string): Promise<ParentPickupState> {
  const me = await myChildren();
  if (!me || !idSchema.safeParse(personId).success) return { error: "Please sign in again." };
  if (!(await checkRateLimitShared(`parent-qr:${me.userId}`, { max: 10, windowMs: 24 * 60 * 60_000 })).ok) return { error: "You've made the most passes allowed today." };
  const db = createAdminClient();
  const { data: links } = await db.from("pickup_people_students").select("student_id").eq("person_id", personId);
  if (!me.students.some((s) => (links ?? []).some((l) => l.student_id === s.id))) return { error: "This person isn't linked to your children." };
  const token = newQrToken();
  const { data } = await db.from("pickup_people").update({ qr_token_hash: hashQrToken(token), qr_issued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", personId).eq("status", "active").select("name, school_id").maybeSingle();
  if (!data) return { error: "Only people who are allowed can get a pass." };
  await writeAudit({ schoolId: data.school_id, actorId: null, action: "pickup.qr", entity: "pickup_people", entityId: personId, details: { by: "parent" } });
  revalidatePath("/parent");
  return { ok: "Pass ready.", pass: { qr: `${QR_PASS_PREFIX}${token}`, name: data.name } };
}

/** Stop someone collecting this parent's children. Other families' links to the same person are untouched. */
export async function parentRemovePickup(personId: string): Promise<ParentPickupState> {
  const me = await myChildren();
  if (!me || !idSchema.safeParse(personId).success) return { error: "Please sign in again." };
  const db = createAdminClient();
  const ids = me.students.map((s) => s.id);
  const { data: removed } = await db.from("pickup_people_students").delete().eq("person_id", personId).in("student_id", ids).select("school_id");
  if (!removed?.length) return { error: "This person isn't linked to your children." };
  const { count } = await db.from("pickup_people_students").select("person_id", { count: "exact", head: true }).eq("person_id", personId);
  if (!count) await db.from("pickup_people").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", personId);
  await writeAudit({ schoolId: removed[0]!.school_id, actorId: null, action: "pickup.revoke", entity: "pickup_people", entityId: personId, details: { by: "parent" } });
  revalidatePath("/parent");
  return { ok: "Removed. They can no longer collect your children." };
}

const codeSchema = z.object({
  person_name: z.string().trim().min(2, "Enter who is collecting.").max(120),
  phone: z.string().trim().max(20).optional(),
  day: z.enum(["today", "tomorrow"]),
  student_ids: z.array(idSchema).min(1, "Choose at least one child.").max(20),
});

/** A one-day code for someone collecting once. */
export async function parentCreatePickupCode(_prev: ParentPickupState, fd: FormData): Promise<ParentPickupState> {
  const me = await myChildren();
  if (!me) return { error: "Please sign in again." };
  if (!(await checkRateLimitShared(`parent-code:${me.userId}`, { max: 10, windowMs: 24 * 60 * 60_000 })).ok) return { error: "You've made the most codes allowed today." };
  const parsed = codeSchema.safeParse({ ...Object.fromEntries(fd), student_ids: fd.getAll("student_ids").map(String) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const phone = v.phone ? normaliseNgPhone(v.phone) : null;
  if (v.phone && !phone) return { error: "Enter a Nigerian phone number, e.g. 0803 123 4567." };
  const kids = me.students.filter((s) => v.student_ids.includes(s.id));
  const schools = [...new Set(kids.map((k) => k.school_id))];
  if (!kids.length) return { error: "Choose at least one of your children." };
  if (schools.length > 1) return { error: "Make one code per school." };
  const schoolId = schools[0]!;

  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("name, timezone").eq("id", schoolId).single();
  if (!school) return { error: "School not found." };
  const validDate = localDate(new Date(Date.now() + (v.day === "tomorrow" ? 86_400_000 : 0)), school.timezone);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPickupCode();
    const { data, error } = await db.from("pickup_codes").insert({
      school_id: schoolId, code_hash: hashPickupCode(schoolId, code), person_name: v.person_name, phone, valid_date: validDate, created_by_guardian_id: kids[0]!.guardian_id,
    }).select("id").single();
    if (error?.code === "23505") continue;
    if (error || !data) return { error: "Could not create the code." };
    await db.from("pickup_code_students").insert(kids.map((k) => ({ code_id: data.id, student_id: k.id, school_id: schoolId })));
    if (phone) {
      await db.from("sms_logs").insert({
        school_id: schoolId, phone, type: "pickup", dedupe_key: `pickup-code:${data.id}`,
        message: `${school.name}: your pickup code for ${v.day} is ${code}. Enter it at the school kiosk. Do not share it.`,
      });
      await processOutbox(db, { limit: 5, schoolId });
    }
    await writeAudit({ schoolId, actorId: null, action: "pickup.parent_code", entity: "pickup_codes", entityId: data.id, details: { person: v.person_name, date: validDate } });
    revalidatePath("/parent");
    return { ok: phone ? "Code created and texted to them." : "Code created.", code: { code, qr: `${QR_CODE_PREFIX}${code}`, person: v.person_name, date: validDate } };
  }
  return { error: "Could not create a code. Please try again." };
}
