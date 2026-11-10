import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/alerts";

export const maxDuration = 60;

/**
 * GET /api/cron/absence (build plan API contract) — queues absence alerts for schools whose
 * cutoff has passed, checks for offline kiosks and queues daily summaries, then sends.
 * Supabase pg_cron also runs the SQL part every 15 minutes; running both is harmless (dedupe keys).
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const [absence, offline, summaries] = await Promise.all([
    db.rpc("queue_absence_alerts"),
    db.rpc("check_offline_devices"),
    db.rpc("queue_daily_summaries"),
  ]);
  const error = absence.error ?? offline.error ?? summaries.error;
  if (error) {
    console.error("cron absence", error);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
  const sending = await processOutbox(db, { limit: 200 });
  return NextResponse.json({
    queued: absence.data as number,
    summaries: summaries.data as number,
    offline_devices: offline.data as number,
    sending,
  });
}
