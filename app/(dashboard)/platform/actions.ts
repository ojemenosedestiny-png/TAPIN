"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { createSchoolSchema, createStaffUserSchema, fieldErrors } from "@/lib/validation";
import { idSchema } from "@/lib/validation";

export type FormState = { ok?: string; errors?: Record<string, string> };

export async function createSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireArea("platform");
  const parsed = createSchoolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const db = createAdminClient();
  const { data, error } = await db.from("schools").insert(parsed.data).select("id, name").single();
  if (error) return { errors: { _form: "Could not create the school. Please try again." } };

  await writeAudit({
    schoolId: data.id, actorId: actor.id, action: "school.create", entity: "schools", entityId: data.id,
    details: { name: data.name },
  });
  revalidatePath("/platform");
  return { ok: `${data.name} created.` };
}

export async function createSchoolUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireArea("platform");
  const parsed = createStaffUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("id").eq("id", input.school_id).maybeSingle();
  if (!school) return { errors: { school_id: "School not found." } };

  const { data: created, error: authError } = await db.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    const taken = authError?.message.toLowerCase().includes("already");
    return { errors: { [taken ? "email" : "_form"]: taken ? "An account with this email already exists." : "Could not create the account." } };
  }

  const { error: profileError } = await db.from("users").insert({
    id: created.user.id, school_id: input.school_id, name: input.name, email: input.email, role: input.role,
  });
  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id); // don't leave a half-made login behind
    return { errors: { _form: "Could not save the account profile." } };
  }

  await writeAudit({
    schoolId: input.school_id, actorId: actor.id, action: "user.create", entity: "users", entityId: created.user.id,
    details: { email: input.email, role: input.role },
  });
  revalidatePath("/platform");
  return { ok: `Account created for ${input.name}. Share the password with them securely.` };
}

/** "Book a demo" requests: mark one as called (or back to waiting). */
export async function setDemoHandled(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireArea("platform");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { errors: { _form: "Invalid request." } };
  const handled = formData.get("handled") === "1";
  const supabase = await createClient(); // RLS: super admin only
  const { error } = await supabase.from("demo_requests").update({ handled_at: handled ? new Date().toISOString() : null }).eq("id", id);
  if (error) return { errors: { _form: "Could not update the request." } };
  await writeAudit({ schoolId: null, actorId: actor.id, action: "demo.handled", entity: "demo_requests", entityId: id, details: { handled } });
  revalidatePath("/platform");
  return { ok: handled ? "Marked as called." : "Moved back to waiting." };
}

/** Edits a school's name, hours, timezone or SMS sender name. */
export async function updateSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireArea("platform");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid school." } };
  const parsed = createSchoolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const plan = formData.get("plan");
  if (plan !== null && plan !== "basic" && plan !== "premium") return { errors: { plan: "Choose Basic or Premium." } };
  let { error } = await createAdminClient().from("schools").update(plan ? { ...parsed.data, plan } : parsed.data).eq("id", id.data);
  // Database not updated yet (no plan column): save everything else.
  if (error && plan && (error.code === "PGRST204" || error.code === "42703")) ({ error } = await createAdminClient().from("schools").update(parsed.data).eq("id", id.data));
  if (error) return { errors: { _form: "Could not save the school." } };
  await writeAudit({ schoolId: id.data, actorId: actor.id, action: "school.edit", entity: "schools", entityId: id.data, details: { name: parsed.data.name, plan } });
  revalidatePath("/platform");
  revalidatePath("/platform/billing");
  return { ok: `${parsed.data.name} saved.` };
}

/**
 * Deletes a school and everything in it (students, staff, attendance, cards, logins, photos). Only for schools
 * with no invoices or payments on record, and only after typing the school's name.
 */
export async function deleteSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireArea("platform");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid school." } };
  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("id, name").eq("id", id.data).maybeSingle();
  if (!school) return { errors: { _form: "That school wasn't found." } };
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== school.name.trim().toLowerCase()) {
    return { errors: { _form: "Type the school's name exactly to confirm." } };
  }
  const [{ count: invoices }, { count: payments }] = await Promise.all([
    db.from("invoices").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    db.from("parent_payments").select("id", { count: "exact", head: true }).eq("school_id", school.id),
  ]);
  if (invoices || payments) return { errors: { _form: "This school has invoices or payments on record, so it can't be deleted." } };

  const { data: logins } = await db.from("users").select("id").eq("school_id", school.id);
  const { data: files } = await db.storage.from("photos").list(school.id, { limit: 1000 });
  const { error } = await db.from("schools").delete().eq("id", school.id);
  if (error) return { errors: { _form: "Could not delete the school. Please try again." } };
  for (const u of logins ?? []) await db.auth.admin.deleteUser(u.id).catch(() => {});
  if (files?.length) await db.storage.from("photos").remove(files.map((f) => `${school.id}/${f.name}`)).catch(() => {});
  await writeAudit({ schoolId: null, actorId: actor.id, action: "school.delete", entity: "schools", entityId: school.id, details: { name: school.name } });
  revalidatePath("/platform");
  revalidatePath("/platform/billing");
  return { ok: `${school.name} was deleted.` };
}
