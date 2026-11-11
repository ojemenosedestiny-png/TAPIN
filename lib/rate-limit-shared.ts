/**
 * Attempt limits that hold across every server instance (stored in Postgres via rate_limit_hit).
 * Use for anything someone could try to guess or flood: sign-in, codes, tokens, public forms.
 *
 * - The in-memory limiter runs first, so a flood from one instance is refused without a database call.
 * - Keys are hashed before they reach the database (no emails or phone numbers stored).
 * - If the database can't be reached, the in-memory answer stands (Supabase Auth has its own limits too).
 * - Requests with no known client address (local tests, no proxy) use the in-memory limit only, so a shared
 *   "unknown" bucket can't lock everyone out.
 */
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";

export function hashLimitKey(key: string): string {
  return createHash("sha256").update(`tapin-rl:${key}`).digest("hex");
}

export async function checkRateLimitShared(
  key: string,
  opts: { max: number; windowMs: number },
  rpc: (key: string, max: number, windowSeconds: number) => Promise<boolean | null> = defaultRpc,
): Promise<RateLimitResult> {
  const local = checkRateLimit(key, opts);
  if (!local.ok) return local;
  if (/(^|:)unknown(:|$)/.test(key)) return local;
  const allowed = await rpc(hashLimitKey(key), opts.max, Math.max(1, Math.ceil(opts.windowMs / 1000)));
  if (allowed === false) return { ok: false, retryAfterMs: opts.windowMs };
  return local;
}

async function defaultRpc(key: string, max: number, windowSeconds: number): Promise<boolean | null> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
    return error ? null : (data as boolean);
  } catch {
    return null;
  }
}
