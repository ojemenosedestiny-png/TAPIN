/**
 * Alerts (build plan §5): every message is created by the server, saved to sms_logs first,
 * then sent through Termii. Nothing is sent from the kiosk.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { greetingForHour } from "@/lib/greeting";
import { friendlyTime, localDate, localHour, localTime } from "@/lib/time";
import { sendSms, sendWhatsAppTemplate, termiiConfig, whatsappTemplateFor, type TermiiConfig } from "@/lib/termii";

export * from "@/lib/alert-rules";
import { alertForTap, chooseChannel, whatsappData, inQuietHours, quietEndsAt, renderTemplate, MAX_ATTEMPTS, MESSAGE_TTL_MS, RETRY_DELAY_MS, type AlertSettings } from "@/lib/alert-rules";

type Db = SupabaseClient;

/**
 * Queues the guardian SMS for a student's tap. Called by /api/tap; the dedupe key
 * (student + date + type + guardian) means a second arrival SMS for the same day is never created.
 */
export async function queueTapAlerts(db: Db, opts: {
  school: { id: string; name: string; timezone: string };
  student: { id: string; firstName: string; fullName: string; classId: string | null; className: string | null };
  action: "signed_in" | "signed_out";
  late: boolean;
  tappedAt: Date;
  early?: boolean;
  reason?: string;
}): Promise<number> {
  const { school, student, tappedAt } = opts;
  const { data: settings } = await db.from("alert_settings").select("*").eq("school_id", school.id).maybeSingle();
  if (!settings) return 0;
  const type = alertForTap(opts.action, opts.late, settings as AlertSettings, opts.early);
  const date = localDate(tappedAt, school.timezone);
  const time = friendlyTime(tappedAt, school.timezone);

  // Late arrival also goes to the class teacher's dashboard (and the admin's).
  if (opts.action === "signed_in" && opts.late) {
    await db.from("notifications").insert({
      school_id: school.id, kind: "late_arrival", class_id: student.classId,
      message: `${student.fullName}${student.className ? ` (${student.className})` : ""} arrived late at ${time}.`,
      dedupe_key: `late:${student.id}:${date}`,
    }).then(({ error }) => error && error.code !== "23505" && console.error("late notification", error));
  }
  if (!type) return 0;

  const { data: links } = await db.from("student_guardians").select("guardians(id, phone)").eq("student_id", student.id);
  const guardians = (links ?? []).map((l) => l.guardians as unknown as { id: string; phone: string }).filter(Boolean);
  if (!guardians.length) return 0;

  const template = (settings as AlertSettings)[`${type}_template`];
  const message = renderTemplate(template, {
    greeting: greetingForHour(localHour(tappedAt, school.timezone)),
    full_name: student.fullName, first_name: student.firstName, school: school.name, time, reason: opts.reason ?? "",
    date: new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: school.timezone }).format(tappedAt),
  });

  const { data, error } = await db.from("sms_logs").upsert(
    guardians.map((g) => ({
      school_id: school.id, student_id: student.id, guardian_id: g.id, phone: g.phone, message, type,
      dedupe_key: `${student.id}:${date}:${type}:${g.id}`,
      vars: { "1": student.fullName, "2": school.name, "3": time, ...(opts.reason ? { "4": opts.reason } : {}) },
    })),
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  ).select("id");
  if (error) console.error("queue sms", error);
  return data?.length ?? 0;
}

export type ProcessResult = { sent: number; failed: number; retrying: number; skipped: number; held: number; notConfigured: boolean };

/**
 * Sends due messages: claims a batch (safe with several senders), applies quiet hours,
 * the monthly allowance and message expiry, then sends through Termii.
 * Failures retry up to 3 times, 2 minutes apart, then show as failed in the dashboard.
 */
export async function processOutbox(db: Db, { limit = 50, send = sendSms, sendWa = sendWhatsAppTemplate, templateFor = whatsappTemplateFor, now = () => new Date(), schoolId = null }: {
  limit?: number; send?: typeof sendSms; sendWa?: typeof sendWhatsAppTemplate; templateFor?: typeof whatsappTemplateFor; now?: () => Date; schoolId?: string | null;
} = {}): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, failed: 0, retrying: 0, skipped: 0, held: 0, notConfigured: false };
  if (!termiiConfig()) {
    result.notConfigured = true;
    return result; // leave everything queued; expiry drops stale messages once SMS is set up
  }

  const { data: batch, error } = await db.rpc("claim_sms", { p_limit: limit, p_school: schoolId });
  if (error) throw error;
  const rows = (batch ?? []) as {
    id: string; school_id: string; guardian_id: string | null; phone: string; message: string; type: string;
    attempts: number; created_at: string; vars: Record<string, unknown> | null;
  }[];
  if (!rows.length) return result;
  const guardianIds = [...new Set(rows.map((r) => r.guardian_id).filter((g): g is string => !!g))];
  const { data: guardians } = guardianIds.length ? await db.from("guardians").select("id, channel").in("id", guardianIds) : { data: [] };
  const channelOf = new Map(((guardians ?? []) as { id: string; channel: string }[]).map((g) => [g.id, g.channel]));

  const schoolIds = [...new Set(rows.map((r) => r.school_id))];
  const [{ data: schools }, { data: settings }] = await Promise.all([
    db.from("schools").select("id, timezone, sms_sender_name").in("id", schoolIds),
    db.from("alert_settings").select("school_id, quiet_start, quiet_end, monthly_allowance").in("school_id", schoolIds),
  ]);
  const schoolById = new Map((schools ?? []).map((s) => [s.id, s]));
  const settingsById = new Map((settings ?? []).map((s) => [s.school_id, s]));
  const usedThisMonth = new Map<string, number>();
  for (const id of schoolIds) {
    const { data: used } = await db.rpc("sms_sent_this_month", { p_school: id });
    usedThisMonth.set(id, (used as number) ?? 0);
  }

  for (const row of rows) {
    const school = schoolById.get(row.school_id);
    const s = settingsById.get(row.school_id);
    const t = now();
    const update = (patch: Record<string, unknown>) => db.from("sms_logs").update({ sending_started_at: null, ...patch }).eq("id", row.id);

    if (!school || !s) { await update({ status: "skipped", last_error: "School not found" }); result.skipped++; continue; }

    if (t.getTime() - new Date(row.created_at).getTime() > MESSAGE_TTL_MS) {
      await update({ status: "skipped", last_error: "Expired: too old to be useful" });
      result.skipped++;
      continue;
    }
    if (inQuietHours(localTime(t, school.timezone), s.quiet_start, s.quiet_end)) {
      await update({ status: "queued", next_attempt_at: quietEndsAt(t, s.quiet_end, school.timezone).toISOString() });
      result.held++;
      continue;
    }
    const used = usedThisMonth.get(row.school_id) ?? 0;
    if (used >= s.monthly_allowance) {
      await update({ status: "skipped", last_error: "Monthly SMS allowance used up" });
      await db.from("notifications").insert({
        school_id: row.school_id, kind: "allowance",
        message: `SMS allowance of ${s.monthly_allowance} for this month is used up. Messages are not being sent.`,
        dedupe_key: `allowance:${row.school_id}:${localDate(t, school.timezone).slice(0, 7)}`,
      }).then(() => {});
      result.skipped++;
      continue;
    }

    const cfg = termiiConfig(school.sms_sender_name) as TermiiConfig;
    // WhatsApp when the guardian chose it and a template exists; a definite WhatsApp failure falls back to SMS at once.
    const template = templateFor(row.type);
    let channel = chooseChannel(row.guardian_id ? channelOf.get(row.guardian_id) : null, !!template);
    let sent = channel === "whatsapp" ? await sendWa(cfg, row.phone, template!, whatsappData(row.vars ?? {})) : await send(cfg, row.phone, row.message);
    if (channel === "whatsapp" && !sent.ok && !sent.retryable) {
      channel = "sms";
      sent = await send(cfg, row.phone, row.message);
    }
    const attempts = row.attempts + 1;
    if (sent.ok) {
      await update({ status: "sent", attempts, channel, sent_at: t.toISOString(), provider_message_id: sent.messageId, last_error: null });
      usedThisMonth.set(row.school_id, used + 1);
      result.sent++;
    } else if (sent.retryable && attempts < MAX_ATTEMPTS) {
      await update({ status: "queued", attempts, last_error: sent.error, next_attempt_at: new Date(t.getTime() + RETRY_DELAY_MS).toISOString() });
      result.retrying++;
    } else {
      await update({ status: "failed", attempts, last_error: sent.error });
      await db.from("notifications").insert({
        school_id: row.school_id, kind: "sms_failed",
        message: `An SMS to ${row.phone} could not be sent: ${sent.error}`,
        dedupe_key: `smsfail:${row.id}`,
      }).then(() => {});
      result.failed++;
    }
  }
  return result;
}
