"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export type EnrollStart = { ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string };

/** Step 1 of turning on two-factor: a new authenticator secret, shown as a QR code. */
export async function startEnroll(): Promise<EnrollStart> {
  await requireArea("account");
  const supabase = await createClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  if ((existing?.totp ?? []).some((f) => f.status === "verified")) return { ok: false, error: "Two-factor login is already on." };
  // Clear any half-finished setup first (Supabase allows only a few unverified factors).
  for (const f of existing?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `TapIn ${Date.now()}` });
  if (error || !data) return { ok: false, error: "Couldn't start two-factor setup. Try again." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Step 2: the first code from the app proves it is set up. */
export async function confirmEnroll(factorId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireArea("account");
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code from the app." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) return { ok: false, error: "That code didn't work. Use the newest code from the app." };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "auth.mfa_enabled", entity: "users", entityId: user.id });
  revalidatePath("/account");
  return { ok: true };
}

/** Turning it off needs a session that already passed the code (requireArea enforces that). */
export async function disableMfa(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireArea("account");
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.all ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return { ok: false, error: "Couldn't turn it off. Sign out and in again, then retry." };
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "auth.mfa_disabled", entity: "users", entityId: user.id });
  revalidatePath("/account");
  return { ok: true };
}
