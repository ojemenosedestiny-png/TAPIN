"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { createStaffUserSchema, fieldErrors } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";
import { idSchema } from "@/lib/validation";
import { z } from "zod";

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

const teamEditSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(2, "Enter a name.").max(120),
  role: z.enum(["school_admin", "teacher"], { message: "Choose a role." }),
});

/** Changes a team member's name or role. You can't demote yourself (so a school is never left without an admin). */
export async function updateTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const parsed = teamEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, name, role } = parsed.data;
  if (id === user.id && role !== "school_admin") return { errors: { role: "You can't remove your own admin role. Ask another admin." } };
  const db = createAdminClient();
  const { data, error } = await db.from("users").update({ name, role }).eq("id", id).eq("school_id", user.schoolId).select("id").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not save. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "user.update", entity: "users", entityId: id, details: { name, role } });
  revalidatePath("/settings");
  return { ok: "Saved." };
}

/** Removes a team member's login. Not yourself, and never the school's last admin. */
export async function removeTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid login." } };
  if (id.data === user.id) return { errors: { _form: "You can't remove your own login." } };
  const db = createAdminClient();
  const { data: member } = await db.from("users").select("id, name, email, role").eq("id", id.data).eq("school_id", user.schoolId).maybeSingle();
  if (!member) return { errors: { _form: "That login wasn't found." } };
  if (member.role === "school_admin") {
    const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("school_id", user.schoolId).eq("role", "school_admin");
    if ((count ?? 0) <= 1) return { errors: { _form: "A school must keep at least one admin." } };
  }
  const { error } = await db.auth.admin.deleteUser(member.id); // the users row goes with it
  if (error) return { errors: { _form: "Could not remove the login. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "user.remove", entity: "users", entityId: member.id, details: { email: member.email, role: member.role } });
  revalidatePath("/settings");
  revalidatePath("/classes");
  return { ok: `${member.name}'s login was removed.` };
}
