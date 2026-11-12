"use server";

import { revalidatePath } from "next/cache";
import { runAfter } from "@/lib/background";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { ALERT_TYPES, processOutbox, SAMPLE_VARS, testAlertMessage, whatsappData, type AlertSettings } from "@/lib/alerts";
import { messagingApi, sendSms, sendWhatsAppTemplate, termiiConfig, whatsappTemplateFor } from "@/lib/termii";
import { formatNgPhone, normaliseNgPhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/rate-limit";
import { alertSettingsSchema, fieldErrors, idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

export async function saveAlertSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("alerts");
  const parsed = alertSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("alert_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("school_id", user.schoolId);
  if (error) return { errors: { _form: "Could not save alert settings. Please try again." } };

  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "alerts.update", entity: "alert_settings", entityId: user.schoolId, details: parsed.data });
  revalidatePath("/alerts");
  return { ok: "Alert settings saved." };
}

/** Puts a failed SMS back in the queue and tries to send it straight away. */
export async function retrySms(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("alerts");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid message." } };
  const supabase = await createClient(); // RLS: only this school's failed messages, only back to queued
  const { data, error } = await supabase
    .from("sms_logs")
    .update({ status: "queued", attempts: 0, next_attempt_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (error || !data) return { errors: { _form: "This message can't be retried." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "sms.retry", entity: "sms_logs", entityId: id.data });
  runAfter("retry send", () => processOutbox(createAdminClient(), { limit: 20, schoolId: user.schoolId }));
  revalidatePath("/alerts");
  return { ok: "Message queued to send again." };
}

/** Sends anything waiting now (instead of waiting for the next scheduled run). */
export async function sendQueuedNow(): Promise<ActionState> {
  const user = await requireSchoolArea("alerts");
  const r = await processOutbox(createAdminClient(), { limit: 100, schoolId: user.schoolId });
  revalidatePath("/alerts");
  if (r.notConfigured) return { errors: { _form: "Messaging isn't connected yet. Connect WhatsApp in Termii, or add an approved SMS sender ID." } };
  return { ok: `Sent ${r.sent}. ${r.retrying ? `${r.retrying} will retry. ` : ""}${r.failed ? `${r.failed} failed. ` : ""}${r.held ? `${r.held} held for quiet hours.` : ""}`.trim() };
}

export async function markAllRead(): Promise<ActionState> {
  const user = await requireSchoolArea("alerts");
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("school_id", user.schoolId).is("read_at", null);
  revalidatePath("/alerts");
  return { ok: "All caught up." };
}

export type TestAlertState = ActionState & { data?: { message: string; sent: boolean; via: "sms" | "whatsapp" } };

/**
 * Sends the school's real template, with sample values and a TEST prefix, to one phone number.
 * Without Termii connected it still shows exactly what parents would get.
 */
export async function sendTestAlert(_prev: TestAlertState, formData: FormData): Promise<TestAlertState> {
  const user = await requireSchoolArea("alerts");
  const type = String(formData.get("type") ?? "");
  if (!(ALERT_TYPES as readonly string[]).includes(type)) return { errors: { type: "Choose a message." } };
  const phone = normaliseNgPhone(String(formData.get("phone") ?? ""));
  if (!phone) return { errors: { phone: "Enter a Nigerian mobile number, like 0803 123 4567." } };
  if (!checkRateLimit(`test-alert:${user.id}`, { max: 5, windowMs: 10 * 60_000 }).ok) {
    return { errors: { _form: "That's 5 test messages in 10 minutes. Please wait a few minutes." } };
  }

  const supabase = await createClient();
  const [{ data: settings }, { data: school }] = await Promise.all([
    supabase.from("alert_settings").select("*").eq("school_id", user.schoolId).single(),
    supabase.from("schools").select("name, sms_sender_name").eq("id", user.schoolId).single(),
  ]);
  if (!settings || !school) return { errors: { _form: "Could not load your alert settings." } };
  const message = testAlertMessage((settings as AlertSettings)[`${type}_template` as keyof AlertSettings] as string, school.name);

  const cfg = termiiConfig(school.sms_sender_name);
  const api = messagingApi();
  const template = whatsappTemplateFor(type);
  const asked = formData.get("via");
  const via: "sms" | "whatsapp" = asked === "whatsapp" || asked === "sms" ? asked : cfg ? "sms" : "whatsapp";
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "alerts.test", entity: "alert_settings", details: { type, via } });

  if (via === "whatsapp") {
    if (!api || !template) {
      return { ok: `Preview only. WhatsApp isn't connected for ${type} alerts yet, so nothing was sent.`, data: { message, sent: false, via } };
    }
    const vars = { "1": SAMPLE_VARS.full_name, "2": school.name, "3": type === "absence" ? SAMPLE_VARS.date : SAMPLE_VARS.time, "4": SAMPLE_VARS.reason };
    const r = await sendWhatsAppTemplate(api, phone, template, whatsappData(vars));
    if (!r.ok) return { errors: { _form: `WhatsApp refused it: ${r.error}` }, data: { message, sent: false, via } };
    return { ok: `Test WhatsApp sent to ${formatNgPhone(phone)}.`, data: { message, sent: true, via } };
  }

  if (!cfg) return { ok: "Preview only. SMS isn't connected yet, so nothing was sent.", data: { message, sent: false, via } };
  const r = await sendSms(cfg, phone, message);
  if (!r.ok) return { errors: { _form: `The SMS provider refused it: ${r.error}` }, data: { message, sent: false, via } };
  return { ok: `Test SMS sent to ${formatNgPhone(phone)}.`, data: { message, sent: true, via } };
}
