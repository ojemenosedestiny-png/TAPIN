"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { homePath, isRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";

export type MfaState = { error?: string };

/** Second step of sign-in: the 6-digit code from the authenticator app. */
export async function verifyMfaCode(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimitShared(`mfa:${auth.user.id}:${ip}`, { max: 6, windowMs: 15 * 60_000 })).ok || !(await checkRateLimitShared(`mfa-account:${auth.user.id}`, { max: 12, windowMs: 60 * 60_000 })).ok) {
    return { error: "Too many wrong codes. Wait 15 minutes, then try again." };
  }

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code didn't work. Check the time on your phone is correct, and use the newest code." };

  const { data: profile } = await supabase.from("users").select("role, school_id").eq("id", auth.user.id).maybeSingle();
  await writeAudit({ schoolId: profile?.school_id ?? null, actorId: auth.user.id, action: "auth.mfa_verified", entity: "users", entityId: auth.user.id });
  redirect(profile && isRole(profile.role) ? homePath(profile.role) : "/");
}

export async function cancelMfa() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
