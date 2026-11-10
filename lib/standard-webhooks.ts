import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Standard Webhooks signature (used by Supabase Auth hooks), without a library.
 * Signed content: `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256 with the base64 secret
 * after "v1,whsec_". The header holds one or more "v1,<base64>" values separated by spaces.
 */
export function verifyStandardWebhook(opts: {
  secret: string; // "v1,whsec_<base64>"
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const { id, timestamp, signature, body } = opts;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false; // replay window

  const key = Buffer.from(opts.secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** For tests: sign a body the way the sender does. */
export function signStandardWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
