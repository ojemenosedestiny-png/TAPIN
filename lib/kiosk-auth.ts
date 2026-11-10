import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashDeviceToken } from "@/lib/devices";
import { checkRateLimit } from "@/lib/rate-limit";

export type KioskDevice = {
  id: string;
  name: string;
  school: { id: string; name: string; logo_url: string | null; timezone: string; resumption_time: string; closing_time: string };
};

export type KioskAuth = { ok: true; device: KioskDevice } | { ok: false; status: number; error: string };

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Verifies "Authorization: Bearer <device token>". Only the SHA-256 hash is stored, and revoked
 * devices are refused immediately. Also marks the device as seen.
 */
export async function authenticateKiosk(req: NextRequest): Promise<KioskAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^tapin_dev_[A-Za-z0-9_-]{20,100}$/.test(token)) {
    // Throttle guessing from one address.
    const limit = checkRateLimit(`kiosk-bad:${clientIp(req)}`, { max: 20, windowMs: 60_000 });
    return { ok: false, status: limit.ok ? 401 : 429, error: "This kiosk isn't registered. Enter a device token." };
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("devices")
    .select("id, name, revoked_at, schools(id, name, logo_url, timezone, resumption_time, closing_time)")
    .eq("token_hash", hashDeviceToken(token))
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: "Server unavailable. Taps are being saved." };
  if (!data) {
    const limit = checkRateLimit(`kiosk-bad:${clientIp(req)}`, { max: 20, windowMs: 60_000 });
    return { ok: false, status: limit.ok ? 401 : 429, error: "This device token isn't valid." };
  }
  if (data.revoked_at) return { ok: false, status: 403, error: "This kiosk has been revoked. Ask the school admin." };

  const perDevice = checkRateLimit(`kiosk:${data.id}`, { max: 240, windowMs: 60_000 });
  if (!perDevice.ok) return { ok: false, status: 429, error: "Too many taps. Wait a moment." };

  // Fire-and-forget heartbeat.
  void db.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", data.id).then(() => {});

  return { ok: true, device: { id: data.id, name: data.name, school: data.schools as unknown as KioskDevice["school"] } };
}
