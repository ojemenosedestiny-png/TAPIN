import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox, type ProcessResult } from "@/lib/alerts";

export const maxDuration = 60;

/** GET /api/cron/send — sends queued and retry-due SMS. Run every 2 minutes by pg_net / cron. */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const total: ProcessResult = { sent: 0, failed: 0, retrying: 0, skipped: 0, held: 0, notConfigured: false };
  // Drain in batches, up to ~500 messages per run.
  for (let i = 0; i < 10; i++) {
    const r = await processOutbox(db, { limit: 50 });
    for (const k of ["sent", "failed", "retrying", "skipped", "held"] as const) total[k] += r[k];
    total.notConfigured = r.notConfigured;
    if (r.notConfigured || r.sent + r.failed + r.retrying + r.skipped + r.held === 0) break;
  }
  return NextResponse.json(total);
}
