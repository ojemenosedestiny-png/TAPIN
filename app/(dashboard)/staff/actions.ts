"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { normaliseNgPhone } from "@/lib/phone";
import { fieldErrors, idSchema, staffSchema } from "@/lib/validation";
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
