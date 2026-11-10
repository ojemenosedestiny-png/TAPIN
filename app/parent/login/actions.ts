"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseNgPhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/rate-limit";
import { LAST_ACTIVE_COOKIE, LAST_ACTIVE_OPTIONS } from "@/lib/auth/idle";

export type ParentLoginState = { step: "phone" | "code"; phone?: string; error?: string; info?: string };

const SENT = "If this number is registered with a school, a 6-digit code is on its way by text message.";

/** Step 1: phone number → code. Only guardians' numbers get one; the answer is the same either way. */
export async function requestCode(_prev: ParentLoginState, formData: FormData): Promise<ParentLoginState> {
  const phone = normaliseNgPhone(String(formData.get("phone") ?? ""));
  if (!phone) return { step: "phone", error: "Enter your mobile number, e.g. 0803 123 4567." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`parent-otp-ip:${ip}`, { max: 10, windowMs: 60 * 60_000 }).ok || !checkRateLimit(`parent-otp:${phone}`, { max: 3, windowMs: 15 * 60_000 }).ok) {
    return { step: "phone", error: "Too many codes requested. Wait 15 minutes and try again." };
  }

  const { data: known } = await createAdminClient().rpc("guardian_phone_exists", { p_phone: phone });
  if (known) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, channel: "sms" } });
    if (error) {
      console.error("parent otp", error.message);
      return { step: "phone", error: "We couldn't send a code right now. Please try again in a few minutes." };
    }
  }
  return { step: "code", phone, info: SENT };
}

/** Step 2: the code → signed in. */
export async function verifyCode(_prev: ParentLoginState, formData: FormData): Promise<ParentLoginState> {
  const phone = normaliseNgPhone(String(formData.get("phone") ?? ""));
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!phone) return { step: "phone", error: "Start again with your number." };
  if (!/^\d{6}$/.test(token)) return { step: "code", phone, error: "Enter the 6-digit code from the text message." };
  if (!checkRateLimit(`parent-verify:${phone}`, { max: 6, windowMs: 15 * 60_000 }).ok) {
    return { step: "code", phone, error: "Too many wrong codes. Ask for a new code in 15 minutes." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return { step: "code", phone, error: "That code didn't work or has expired. Check it, or ask for a new one." };
  (await cookies()).set(LAST_ACTIVE_COOKIE, String(Date.now()), LAST_ACTIVE_OPTIONS);
  redirect("/parent");
}

export async function parentSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(LAST_ACTIVE_COOKIE);
  redirect("/parent/login");
}
