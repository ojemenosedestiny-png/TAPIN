"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { createSchoolSchema, createStaffUserSchema, fieldErrors } from "@/lib/validation";

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
