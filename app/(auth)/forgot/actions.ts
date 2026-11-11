"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { emailSchema, fieldErrors } from "@/lib/validation";
import { z } from "zod";

export type ForgotState = { sent?: boolean; errors?: Record<string, string> };

/** Emails a reset link. Always answers the same way, so it can't be used to find out who has an account. */
export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = z.object({ email: emailSchema }).safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimitShared(`forgot:${ip}`, { max: 5, windowMs: 60 * 60_000 })).ok || !(await checkRateLimitShared(`forgot-account:${parsed.data.email}`, { max: 3, windowMs: 60 * 60_000 })).ok) {
    return { errors: { _form: "Too many requests. Try again in an hour." } };
  }

  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${proto}://${host}/auth/callback?next=/auth/new-password` });
  if (error && error.status !== 429) console.error("reset email", error.message);
  return { sent: true };
}
