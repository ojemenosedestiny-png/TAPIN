"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { createStaffUserSchema, fieldErrors } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

/** School admin creates a login for a teacher (or another school admin) in their own school. */
export async function createTeamLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  // school_id always comes from the session, never from the form.
  const parsed = createStaffUserSchema.safeParse({ ...Object.fromEntries(formData), school_id: user.schoolId });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const db = createAdminClient();
  const { data: created, error } = await db.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true });
  if (error || !created.user) {
    const taken = error?.message.toLowerCase().includes("already");
    return { errors: taken ? { email: "An account with this email already exists." } : { _form: "Could not create the login." } };
  }
  const { error: pErr } = await db.from("users").insert({ id: created.user.id, school_id: user.schoolId, name: input.name, email: input.email, role: input.role });
  if (pErr) {
    await db.auth.admin.deleteUser(created.user.id);
    return { errors: { _form: "Could not save the login." } };
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "user.create", entity: "users", entityId: created.user.id, details: { email: input.email, role: input.role } });
  revalidatePath("/settings");
  revalidatePath("/classes");
  return { ok: `Login created for ${input.name}. Share the password with them privately.` };
}
