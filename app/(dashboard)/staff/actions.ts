"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { normaliseNgPhone } from "@/lib/phone";
import { fieldErrors, idSchema, staffSchema } from "@/lib/validation";
import { hashPin } from "@/lib/emergency";
import { validStaffPin, weakPin } from "@/lib/staff-security";
import type { ActionState } from "@/components/forms/field";

export async function saveStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("staff");
  const id = formData.get("id");
  const parsed = staffSchema.safeParse({
    name: formData.get("name"), phone: formData.get("phone") || undefined, status: formData.get("status") || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  let phone: string | null = null;
  if (parsed.data.phone) {
    phone = normaliseNgPhone(parsed.data.phone);
    if (!phone) return { errors: { phone: "Enter a Nigerian mobile number, e.g. 0803 123 4567." } };
  }

  const supabase = await createClient();
  const isEdit = typeof id === "string" && id.length > 0;
  if (isEdit && !idSchema.safeParse(id).success) return { errors: { _form: "Invalid staff member." } };
  const row = { name: parsed.data.name, phone, status: parsed.data.status };

  const { data, error } = isEdit
    ? await supabase.from("staff").update(row).eq("id", id).select("id").single()
    : await supabase.from("staff").insert({ ...row, school_id: user.schoolId }).select("id").single();
  if (error) return { errors: { _form: "Could not save. Please try again." } };

  if (isEdit && row.status === "inactive") {
    const { data: card } = await supabase.from("cards").select("id").eq("holder_type", "staff").eq("holder_id", data.id).eq("status", "active").maybeSingle();
    if (card) await createAdminClient().rpc("set_card_status", { p_school_id: user.schoolId, p_actor_id: user.id, p_card_id: card.id, p_status: "blocked" });
  }

  await writeAudit({
    schoolId: user.schoolId, actorId: user.id, action: isEdit ? "staff.update" : "staff.create", entity: "staff", entityId: data.id,
    details: { status: row.status },
  });
  revalidatePath("/staff");
  return { ok: isEdit ? `${row.name} updated.` : `${row.name} added.`, data: { id: data.id } };
}

/** Deletes a staff member entered by mistake, with their attendance and cards. Use Inactive for someone who left. */
export async function deleteStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("staff");
  if (user.role !== "school_admin") return { errors: { _form: "Only school admins can delete staff." } };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid staff member." } };
  const supabase = await createClient(); // RLS: only this school's staff are visible
  const { data: s } = await supabase.from("staff").select("id, name").eq("id", id.data).maybeSingle();
  if (!s) return { errors: { _form: "That staff member wasn't found." } };
  const { error } = await createAdminClient().rpc("delete_staff_records", { p_id: s.id });
  if (error) return { errors: { _form: "Could not delete. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "staff.delete", entity: "staff", entityId: s.id, details: { name: s.name } });
  revalidatePath("/staff");
  return { ok: `${s.name} was deleted.` };
}

/** The staff member must belong to this school (checked with the admin's own access). */
async function ownStaff(id: string): Promise<{ id: string; name: string; schoolId: string; userId: string } | null> {
  const user = await requireSchoolArea("staff");
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("id, name, school_id").eq("id", id).eq("school_id", user.schoolId).maybeSingle();
  return data ? { id: data.id, name: data.name, schoolId: user.schoolId, userId: user.id } : null;
}

/** Sets (or changes) a staff member's 4-digit check-in PIN. Stored hashed; nobody can read it back. */
export async function setStaffPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = idSchema.safeParse(formData.get("staff_id"));
  if (!id.success) return { errors: { _form: "Invalid request." } };
  const pin = String(formData.get("pin") ?? "");
  const again = String(formData.get("pin_again") ?? "");
  if (!validStaffPin(pin)) return { errors: { pin: "Exactly 4 digits." } };
  if (weakPin(pin)) return { errors: { pin: "Too easy to guess. Avoid 1234 or the same digit four times." } };
  if (pin !== again) return { errors: { pin_again: "The two PINs don't match." } };
  const s = await ownStaff(id.data);
  if (!s) return { errors: { _form: "Staff member not found." } };
  const { error } = await createAdminClient().from("staff_pins")
    .upsert({ staff_id: s.id, school_id: s.schoolId, pin_hash: hashPin(pin), failures: 0, locked_until: null, set_at: new Date().toISOString() }, { onConflict: "staff_id" });
  if (error) return { errors: { _form: "Could not save the PIN." } };
  await writeAudit({ schoolId: s.schoolId, actorId: s.userId, action: "staff.pin_set", entity: "staff", entityId: s.id, details: { name: s.name } });
  revalidatePath("/staff");
  revalidatePath("/settings");
  return { ok: `PIN set for ${s.name}. Tell them privately.` };
}

/** Removes a PIN, or lifts a wrong-PIN lockout. */
export async function changeStaffPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = idSchema.safeParse(formData.get("staff_id"));
  const what = formData.get("what");
  if (!id.success || (what !== "remove" && what !== "unlock")) return { errors: { _form: "Invalid request." } };
  const s = await ownStaff(id.data);
  if (!s) return { errors: { _form: "Staff member not found." } };
  const db = createAdminClient();
  const { error } = what === "remove"
    ? await db.from("staff_pins").delete().eq("staff_id", s.id)
    : await db.from("staff_pins").update({ failures: 0, locked_until: null }).eq("staff_id", s.id);
  if (error) return { errors: { _form: "Could not save." } };
  await writeAudit({ schoolId: s.schoolId, actorId: s.userId, action: what === "remove" ? "staff.pin_remove" : "staff.pin_unlock", entity: "staff", entityId: s.id, details: { name: s.name } });
  revalidatePath("/staff");
  revalidatePath("/settings");
  return { ok: what === "remove" ? `${s.name}'s PIN removed.` : `${s.name} can check in again.` };
}
