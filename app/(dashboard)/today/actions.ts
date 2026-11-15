"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { friendlyTime } from "@/lib/time";
import { messagingApi, sendWhatsAppText } from "@/lib/termii";
import { SESSION_MS } from "@/lib/whatsapp-assistant";
import type { ActionState } from "@/components/forms/field";

const form = z.object({ id: idSchema, decision: z.enum(["approve", "decline"]) });

/**
 * The office answers a parent's early pickup request. Approving records the early release, so the child may
 * sign out before closing. If the parent wrote to the WhatsApp assistant in the last 24 hours, they hear back.
 */
export async function answerEarlyPickup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("pickup");
  const parsed = form.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid request." } };
  const { id, decision } = parsed.data;
  const db = createAdminClient();
  const { data: r } = await db.from("early_pickup_requests")
    .select("id, student_id, guardian_id, date, at_time, note, status, students(first_name, last_name), schools(name)")
    .eq("id", id).eq("school_id", user.schoolId).maybeSingle();
  if (!r) return { errors: { _form: "This request no longer exists." } };
  if (r.status !== "pending") return { ok: "Already answered." };

  const child = r.students as unknown as { first_name: string; last_name: string } | null;
  const school = (r.schools as unknown as { name: string } | null)?.name ?? "The school";
  const at = r.at_time ? friendlyTime(new Date(`2026-01-01T${(r.at_time as string).slice(0, 5)}:00Z`), "UTC") : null;
  const now = new Date().toISOString();

  if (decision === "approve") {
    const reason = `Parent collecting${at ? ` at ${at}` : ""} (requested by WhatsApp)`.slice(0, 200);
    const { error } = await db.from("early_releases").upsert(
      { school_id: user.schoolId, holder_type: "student", holder_id: r.student_id, date: r.date, reason, approved_by: user.id },
      { onConflict: "holder_type,holder_id,date", ignoreDuplicates: true },
    );
    if (error) return { errors: { _form: "Could not approve. Please try again." } };
  }
  await db.from("early_pickup_requests").update({ status: decision === "approve" ? "approved" : "declined", handled_by: user.id, handled_at: now }).eq("id", r.id).eq("status", "pending");
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: decision === "approve" ? "early.approve" : "early.decline", entity: "early_pickup_requests", entityId: r.id, details: { student: r.student_id, at: r.at_time } });

  // A free WhatsApp reply is only allowed within 24 hours of the parent's own message.
  if (r.guardian_id && child) {
    const { data: g } = await db.from("guardians").select("phone").eq("id", r.guardian_id).maybeSingle();
    const { data: last } = g ? await db.from("whatsapp_messages").select("created_at").eq("phone", g.phone).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const api = messagingApi();
    if (g && api && last && Date.now() - new Date(last.created_at).getTime() < SESSION_MS) {
      const text = decision === "approve"
        ? `${school}: your early pickup of ${child.first_name}${at ? ` at ${at}` : ""} today is approved. Please tap your card, or bring your pickup code, at the gate.`
        : `${school}: we couldn't approve collecting ${child.first_name} early today. Please call the school.`;
      const sent = await sendWhatsAppText(api, g.phone, text);
      await db.from("whatsapp_messages").insert({
        school_id: user.schoolId, guardian_id: r.guardian_id, phone: g.phone, direction: "out", body: text, command: "early",
        status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.error, provider_id: sent.ok ? sent.messageId : null,
      });
    }
  }
  revalidatePath("/today");
  const name = child ? child.first_name : "The child";
  return { ok: decision === "approve" ? `${name} may leave early${at ? ` at ${at}` : ""} today.` : "Request declined." };
}
