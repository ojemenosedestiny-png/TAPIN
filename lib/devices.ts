import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Kiosk is "online" if it checked in within this window (plan §5: offline after 10 minutes). */
export const DEVICE_OFFLINE_AFTER_MS = 10 * 60 * 1000;

/** A new device token: 32 random bytes, URL-safe, with a prefix so it's recognisable if leaked. */
export function generateDeviceToken(): string {
  return `tapin_dev_${randomBytes(32).toString("base64url")}`;
}

/** Only this hash is stored. SHA-256 is fine here: the token is high-entropy random, not a password. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatchesHash(token: string, hash: string): boolean {
  const a = Buffer.from(hashDeviceToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type DeviceStatus = "online" | "offline" | "never" | "revoked";

export function deviceStatus(d: { last_seen: string | null; revoked_at: string | null }, now = Date.now()): DeviceStatus {
  if (d.revoked_at) return "revoked";
  if (!d.last_seen) return "never";
  return now - new Date(d.last_seen).getTime() <= DEVICE_OFFLINE_AFTER_MS ? "online" : "offline";
}
