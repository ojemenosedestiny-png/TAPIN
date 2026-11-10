"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

/** Revoke a lost or stolen kiosk. Its token stops working immediately (/api/tap checks revoked_at). */
export async function revokeDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("devices");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { errors: { _form: "Invalid device." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).is("revoked_at", null).select("id, name").maybeSingle();
  if (error || !data) return { errors: { _form: "Could not revoke this device." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "device.revoke", entity: "devices", entityId: data.id, details: { name: data.name } });
  revalidatePath("/devices");
  return { ok: `${data.name} revoked. Its token no longer works.` };
}
