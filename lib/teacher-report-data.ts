import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDate } from "@/lib/time";
import { buildTeacherMonth, monthRange, schoolDays, shiftMonth, type MonthAttendance, type MonthLesson, type TeacherMonth } from "@/lib/teacher-report";

export type MonthlyReport = {
  school: { id: string; name: string; logoUrl: string | null };
  month: string;
  rows: TeacherMonth[];
  previous: Map<string, TeacherMonth>;
  schoolDays: number;
};

/**
 * Loads one school's monthly teacher report, with last month for comparison.
 * The caller decides who may see it; pass the service-role client.
 */
export async function loadMonthlyReport(db: SupabaseClient, schoolId: string, month: string, onlyStaffId?: string): Promise<MonthlyReport | null> {
  const { data: school } = await db.from("schools").select("id, name, logo_url, timezone, resumption_time").eq("id", schoolId).maybeSingle();
  if (!school) return null;
  const today = localDate(new Date(), school.timezone);
  const prevMonth = shiftMonth(month, -1);
  const span = { from: monthRange(prevMonth).from, to: monthRange(month).to };

  let staffQ = db.from("staff").select("id, name").eq("school_id", schoolId).eq("status", "active").order("name");
  if (onlyStaffId) staffQ = staffQ.eq("id", onlyStaffId);
  const [{ data: staff }, { data: holidays }, { data: attendance }, { data: lessons }] = await Promise.all([
    staffQ,
    db.from("school_calendar").select("date").eq("school_id", schoolId).eq("is_holiday", true).gte("date", span.from).lte("date", span.to),
    db.from("attendance").select("holder_id, date, sign_in_at, sign_out_at, auto_signed_out")
      .eq("school_id", schoolId).eq("holder_type", "staff").gte("date", span.from).lte("date", span.to).limit(50_000),
    db.from("lessons").select("staff_id, date, duration_minutes, flags, status").eq("school_id", schoolId).gte("date", span.from).lte("date", span.to).limit(50_000),
  ]);
  const off = new Set((holidays ?? []).map((h) => h.date as string));
  const build = (m: string) => {
    const r = monthRange(m);
    return buildTeacherMonth({
      staff: staff ?? [], today, timeZone: school.timezone, resumptionTime: school.resumption_time,
      days: schoolDays(m, today, off),
      attendance: ((attendance ?? []) as MonthAttendance[]).filter((a) => a.date >= r.from && a.date <= r.to),
      lessons: ((lessons ?? []) as (MonthLesson & { date: string })[]).filter((l) => l.date >= r.from && l.date <= r.to),
    });
  };
  const rows = build(month);
  let logoUrl: string | null = null;
  if (school.logo_url) {
    const { data } = await db.storage.from("photos").createSignedUrl(school.logo_url, 600);
    logoUrl = data?.signedUrl ?? null;
  }
  return {
    school: { id: school.id, name: school.name, logoUrl },
    month,
    rows,
    previous: new Map(build(prevMonth).map((r) => [r.staffId, r])),
    schoolDays: rows[0]?.schoolDays ?? schoolDays(month, today, off).length,
  };
}

export const REPORT_LINK_DAYS = 60;

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a private link to a month's report. Returns the path, e.g. /r/abc… */
export async function createReportLink(db: SupabaseClient, schoolId: string, month: string, createdBy: string | null): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const { error } = await db.from("report_links").insert({
    school_id: schoolId, month, token_hash: hashReportToken(token), created_by: createdBy,
    expires_at: new Date(Date.now() + REPORT_LINK_DAYS * 86_400_000).toISOString(),
  });
  return error ? null : `/r/${token}`;
}

/** The school and month a link opens, or null when it is unknown or expired. */
export async function resolveReportLink(db: SupabaseClient, token: string): Promise<{ schoolId: string; month: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await db.from("report_links").select("school_id, month, expires_at").eq("token_hash", hashReportToken(token)).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return { schoolId: data.school_id, month: data.month };
}
