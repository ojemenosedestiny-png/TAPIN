"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea, type SchoolUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { processOutbox, queueTapAlerts } from "@/lib/alerts";
import { runAfter } from "@/lib/background";
import { localDate } from "@/lib/time";
import { fieldErrors } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

const schema = z.object({
  holder_type: z.enum(["student", "staff"]),
  holder_id: z.string().uuid(),
  reason: z.string().trim().min(2, "Give a short reason, e.g. Sick, collected by mother.").max(200),
  mode: z.enum(["gate", "now"]),
});

/** May this user release this person? School admins: anyone. Teachers: students in their own classes. */
async function canRelease(user: SchoolUser, holderType: "student" | "staff", holderId: string) {
  if (user.role === "school_admin") return true;
  if (holderType !== "student") return false;
  const supabase = await createClient();
  const { data } = await supabase.from("students").select("id").eq("id", holderId).maybeSingle(); // RLS: own classes only
  return !!data;
}

/**
 * Early release (build plan follow-up): "gate" lets the next tap sign them out before closing;
 * "now" signs them out immediately (collected without tapping). Parents get an early-release SMS.
 */
export async function releaseEarly(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("today");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { holder_type, holder_id, reason, mode } = parsed.data;
  if (!(await canRelease(user, holder_type, holder_id))) return { errors: { _form: "You can only release students in your own classes." } };

  const db = createAdminClient();
  const { data: school } = await db.from("schools").select("id, name, timezone").eq("id", user.schoolId).single();
  if (!school) return { errors: { _form: "School not found." } };
  const now = new Date();
  const date = localDate(now, school.timezone);

  // The person must belong to this school.
  const table = holder_type === "student" ? "students" : "staff";
  const { data: person } = await db.from(table).select("id, school_id").eq("id", holder_id).maybeSingle();
  if (!person || person.school_id !== user.schoolId) return { errors: { _form: "Not found." } };

  const { error: relErr } = await db.from("early_releases").upsert(
    { school_id: user.schoolId, holder_type, holder_id, date, reason, approved_by: user.id, used_at: mode === "now" ? now.toISOString() : null },
    { onConflict: "holder_type,holder_id,date" },
  );
  if (relErr) return { errors: { _form: "Could not save the release." } };

  if (mode === "now") {
    const { data: row, error } = await db.from("attendance")
      .update({ sign_out_at: now.toISOString(), early_release: true })
      .eq("school_id", user.schoolId).eq("holder_type", holder_type).eq("holder_id", holder_id).eq("date", date)
      .not("sign_in_at", "is", null).is("sign_out_at", null)
      .select("id").maybeSingle();
    if (error) return { errors: { _form: "Could not sign out." } };
    if (!row) return { errors: { _form: "They aren't signed in today (or already signed out)." } };

    if (holder_type === "student") {
      const { data: st } = await db.from("students").select("first_name, last_name, class_id, classes(name)").eq("id", holder_id).single();
      runAfter("early release sms", async () => {
        const queued = await queueTapAlerts(db, {
          school, action: "signed_out", late: false, tappedAt: now, early: true, reason,
          student: {
            id: holder_id, firstName: st!.first_name, fullName: `${st!.first_name} ${st!.last_name}`,
            classId: st!.class_id, className: (st!.classes as unknown as { name: string } | null)?.name ?? null,
          },
        });
        if (queued) await processOutbox(db, { limit: 10, schoolId: school.id });
      });
    }
  }

  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: mode === "now" ? "release.sign_out" : "release.allow", entity: table, entityId: holder_id, details: { date, reason } });
  revalidatePath("/today");
  revalidatePath("/students");
  revalidatePath("/staff");
  return { ok: mode === "now" ? "Signed out. Parents are being told." : "Released: their next tap at the gate signs them out." };
}

export async function cancelRelease(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("today");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid release." } };
  const supabase = await createClient(); // RLS: admin or class teacher, only unused releases
  const { data, error } = await supabase.from("early_releases").delete().eq("id", id.data).is("used_at", null).select("holder_id").maybeSingle();
  if (error || !data) return { errors: { _form: "This release was already used or can't be cancelled." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "release.cancel", entity: "early_releases", entityId: id.data });
  revalidatePath("/today");
  revalidatePath("/students");
  return { ok: "Early release cancelled." };
}
