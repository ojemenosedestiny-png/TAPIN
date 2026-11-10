"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, passwordSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export type NewPasswordState = { errors?: Record<string, string> };

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

export async function setNewPassword(_prev: NewPasswordState, formData: FormData): Promise<NewPasswordState> {
  const parsed = schema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { errors: { _form: "This reset link has expired. Ask for a new one." } };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { errors: { _form: error.message.includes("different") ? "Choose a password you haven't used here before." : "Could not change the password. Try again." } };
  const { data: profile } = await supabase.from("users").select("school_id").eq("id", auth.user.id).maybeSingle();
  await writeAudit({ schoolId: profile?.school_id ?? null, actorId: auth.user.id, action: "user.password_reset", entity: "users", entityId: auth.user.id, details: { via: "email" } });
  redirect("/");
}
