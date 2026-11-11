"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { LAST_ACTIVE_COOKIE, LAST_ACTIVE_OPTIONS } from "@/lib/auth/idle";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, loginSchema } from "@/lib/validation";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { homePath, isRole } from "@/lib/auth/roles";

export type LoginState = { errors?: Record<string, string>; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = { email: formData.get("email"), password: formData.get("password") };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), email: String(raw.email ?? "") };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Per address + account, and per account from anywhere (guessing spread over many addresses).
  const perIp = await checkRateLimitShared(`login:${ip}:${parsed.data.email}`, { max: 5, windowMs: 15 * 60 * 1000 });
  const perAccount = perIp.ok ? await checkRateLimitShared(`login-account:${parsed.data.email}`, { max: 15, windowMs: 60 * 60 * 1000 }) : perIp;
  const limit = perIp.ok ? perAccount : perIp;
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
  const { data: profile } = await supabase.from("users").select("id, role").eq("id", userData.user?.id ?? "").maybeSingle();
  if (!profile || !isRole(profile.role)) {
    await supabase.auth.signOut();
    return { errors: { _form: "This account has not been set up for TapIn. Contact your school admin." } };
  }

  // A fresh sign-in starts a fresh idle timer (a stale stamp from an old session would sign them straight out).
  (await cookies()).set(LAST_ACTIVE_COOKIE, String(Date.now()), LAST_ACTIVE_OPTIONS);
  // Two-factor on: the password is only half of it.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/auth/mfa");
  redirect(homePath(profile.role));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(LAST_ACTIVE_COOKIE);
  redirect("/login");
}
