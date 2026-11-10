"use server";

import { revalidatePath } from "next/cache";
import { runAfter } from "@/lib/background";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { processOutbox } from "@/lib/alerts";
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
  if (r.notConfigured) return { errors: { _form: "SMS isn't connected yet. Add the Termii API key and sender ID first." } };
  return { ok: `Sent ${r.sent}. ${r.retrying ? `${r.retrying} will retry. ` : ""}${r.failed ? `${r.failed} failed. ` : ""}${r.held ? `${r.held} held for quiet hours.` : ""}`.trim() };
}

export async function markAllRead(): Promise<ActionState> {
  const user = await requireSchoolArea("alerts");
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("school_id", user.schoolId).is("read_at", null);
  revalidatePath("/alerts");
  return { ok: "All caught up." };
}
