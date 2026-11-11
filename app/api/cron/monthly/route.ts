import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate } from "@/lib/time";
import { monthLabel, monthOf, shiftMonth } from "@/lib/teacher-report";
import { createReportLink } from "@/lib/teacher-report-data";
import { processOutbox } from "@/lib/alerts";

export const maxDuration = 60;

/**
 * GET /api/cron/monthly — daily at 08:00 Lagos. On the 1st of the month (school time), every school
 * using lessons with a director's phone gets an SMS link to last month's teacher report. Once only.
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: schools, error } = await db.from("lesson_settings")
    .select("school_id, director_phone, schools(name, timezone)").eq("enabled", true).not("director_phone", "is", null);
  if (error) return NextResponse.json({ error: "Could not list schools." }, { status: 500 });

  let sent = 0;
  for (const s of schools ?? []) {
    const school = s.schools as unknown as { name: string; timezone: string } | null;
    if (!school || !s.director_phone) continue;
    const today = localDate(new Date(), school.timezone);
    if (!today.endsWith("-01")) continue;
    const month = shiftMonth(monthOf(today), -1);
    const dedupe = `monthly-auto:${s.school_id}:${month}`;
    const { data: already } = await db.from("sms_logs").select("id").eq("dedupe_key", dedupe).maybeSingle();
    if (already) continue;
    const path = await createReportLink(db, s.school_id, month, null);
    if (!path) continue;
    const { error: smsErr } = await db.from("sms_logs").insert({
      school_id: s.school_id, phone: s.director_phone, type: "director", dedupe_key: dedupe,
      message: `${school.name}: teacher report for ${monthLabel(month)} is ready. ${req.nextUrl.origin}${path}`,
    });
    if (!smsErr) sent++;
  }
  if (sent) await processOutbox(db, { limit: 50 });
  return NextResponse.json({ sent });
}
