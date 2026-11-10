"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, holidaySchema, schoolDaySchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

export async function saveSchoolDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const parsed = schoolDaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("schools").update(parsed.data).eq("id", user.schoolId);
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "school.update", entity: "schools", entityId: user.schoolId, details: parsed.data });
  revalidatePath("/settings");
  return { ok: "School day saved." };
}

/** Marks one day or a range (e.g. mid-term break) as holidays: no absence alerts, not counted absent. */
export async function addHolidays(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { from, to, note } = parsed.data;

  const rows: { school_id: string; date: string; is_holiday: boolean; note: string | null }[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekends are never school days anyway
    rows.push({ school_id: user.schoolId, date: d.toISOString().slice(0, 10), is_holiday: true, note });
  }
  if (!rows.length) return { errors: { from: "Those dates are all weekend days." } };

  const supabase = await createClient();
  const { error } = await supabase.from("school_calendar").upsert(rows, { onConflict: "school_id,date" });
  if (error) return { errors: { _form: "Could not save the dates." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "calendar.add", entity: "school_calendar", details: { from, to, note, days: rows.length } });
  revalidatePath("/settings");
  return { ok: `${rows.length} school day${rows.length === 1 ? "" : "s"} marked as holiday.` };
}

export async function removeHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { errors: { _form: "Invalid date." } };
  const supabase = await createClient();
  const { error } = await supabase.from("school_calendar").delete().eq("school_id", user.schoolId).eq("date", date);
  if (error) return { errors: { _form: "Could not remove the date." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "calendar.remove", entity: "school_calendar", details: { date } });
  revalidatePath("/settings");
  return { ok: "Holiday removed." };
}
