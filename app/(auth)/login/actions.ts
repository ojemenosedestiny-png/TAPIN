"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, loginSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

export type LoginState = { errors?: Record<string, string>; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = { email: formData.get("email"), password: formData.get("password") };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), email: String(raw.email ?? "") };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = checkRateLimit(`login:${ip}:${parsed.data.email}`, { max: 5, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    return {
      errors: { _form: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.` },
      email: parsed.data.email,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message for wrong email or password: don't reveal which accounts exist.
    return { errors: { _form: "Email or password is incorrect." }, email: parsed.data.email };
  }

  // Must have a staff profile, otherwise the account is not usable.
  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("id").eq("id", userData.user?.id ?? "").maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { errors: { _form: "This account has not been set up for TapIn. Contact your school admin." } };
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
