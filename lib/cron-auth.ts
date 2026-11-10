import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Scheduled jobs (Vercel Cron / Supabase pg_net) send "Authorization: Bearer <CRON_SECRET>". */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
