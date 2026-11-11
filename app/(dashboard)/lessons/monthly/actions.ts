"use server";

import { headers } from "next/headers";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { createReportLink, REPORT_LINK_DAYS } from "@/lib/teacher-report-data";
import { monthLabel, parseMonth } from "@/lib/teacher-report";
import { processOutbox } from "@/lib/alerts";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import type { ActionState } from "@/components/forms/field";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** A private link to the month's report (no login needed), and optionally an SMS to the director. */
export async function shareMonthlyReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const month = parseMonth(String(fd.get("month") ?? ""), "");
  if (!month) return { errors: { _form: "Choose a month." } };
  const sms = fd.get("send") === "sms";
  if (!(await checkRateLimitShared(`report-link:${user.id}`, { max: 20, windowMs: 60 * 60_000 })).ok) return { errors: { _form: "Too many links. Try again later." } };

  const db = createAdminClient();
  let phone: string | null = null;
  if (sms) {
    const { data } = await db.from("lesson_settings").select("director_phone").eq("school_id", user.schoolId).maybeSingle();
    phone = data?.director_phone ?? null;
    if (!phone) return { errors: { _form: "Add the director's phone in Lessons → Setup first." } };
  }
  const path = await createReportLink(db, user.schoolId, month, user.id);
  if (!path) return { errors: { _form: "Could not create the link. Please try again." } };
  const url = `${await origin()}${path}`;

  if (phone) {
    const { data: school } = await db.from("schools").select("name").eq("id", user.schoolId).single();
    const { error } = await db.from("sms_logs").insert({
      school_id: user.schoolId, phone, type: "director", dedupe_key: `monthly:${path}`,
      message: `${school?.name ?? "Your school"}: teacher report for ${monthLabel(month)} is ready. ${url}`,
    });
    if (error) return { errors: { _form: "Could not queue the SMS." } };
    await processOutbox(db, { limit: 5, schoolId: user.schoolId });
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "report.share", entity: "report_links", details: { month, sms } });
  return { ok: phone ? "Sent to the director by SMS." : `Link ready. It works for ${REPORT_LINK_DAYS} days.`, data: { url } };
}
