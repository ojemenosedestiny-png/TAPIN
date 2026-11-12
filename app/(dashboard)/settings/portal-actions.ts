"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { keyTail, normalisePortalUrl, pingPortal, processPortalDeliveries } from "@/lib/portal-link";
import type { ActionState } from "@/components/forms/field";

/** Saves the school portal address and kiosk key. A blank key keeps the saved one. */
export async function savePortalLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const url = normalisePortalUrl(String(formData.get("url") ?? ""));
  if (!url) return { errors: { url: "Enter the portal's https address, e.g. https://yourschool.com/api/kiosk/tap" } };
  const key = String(formData.get("api_key") ?? "").trim();
  if (key && (key.length < 8 || key.length > 300 || /\s/.test(key))) return { errors: { api_key: "Paste the whole kiosk key, with no spaces." } };
  const matchBy = formData.get("match_by") === "admission" ? "admission" : "card";
  const enabled = formData.get("enabled") === "on";

  const db = createAdminClient();
  const { data: existing } = await db.from("portal_links").select("school_id").eq("school_id", user.schoolId).maybeSingle();
  if (!existing && !key) return { errors: { api_key: "Paste the kiosk key from the portal." } };
  const row = { url, match_by: matchBy, enabled, updated_at: new Date().toISOString(), ...(key ? { api_key: key, key_tail: keyTail(key), last_error: null } : {}) };
  const { error } = existing
    ? await db.from("portal_links").update(row).eq("school_id", user.schoolId)
    : await db.from("portal_links").insert({ school_id: user.schoolId, ...row, api_key: key, key_tail: keyTail(key) });
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "portal.update", entity: "portal_links", entityId: user.schoolId, details: { url, matchBy, enabled, newKey: !!key } });
  revalidatePath("/settings");
  return { ok: enabled ? "Saved. New sign-ins now go to the school portal." : "Saved. Sending to the portal is paused." };
}

/** Checks the address and key with the portal, then sends anything that was waiting. */
export async function testPortalLink(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  if (!checkRateLimit(`portal-test:${user.id}`, { max: 10, windowMs: 10 * 60_000 }).ok) return { errors: { _form: "Please wait a few minutes before testing again." } };
  const db = createAdminClient();
  const { data: link } = await db.from("portal_links").select("url, api_key").eq("school_id", user.schoolId).maybeSingle();
  if (!link) return { errors: { _form: "Save the portal address and key first." } };
  const r = await pingPortal(link.url as string, link.api_key as string);
  if (!r.ok) {
    await db.from("portal_links").update({ last_error: r.error }).eq("school_id", user.schoolId);
    revalidatePath("/settings");
    return { errors: { _form: r.error } };
  }
  await db.from("portal_links").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("school_id", user.schoolId);
  // Taps held back by a wrong key go now.
  await db.from("portal_deliveries").update({ next_at: new Date().toISOString() }).eq("school_id", user.schoolId).eq("status", "pending");
  await processPortalDeliveries(db, { limit: 50, schoolId: user.schoolId });
  revalidatePath("/settings");
  return { ok: `Connected${r.kiosk ? ` as "${r.kiosk}"` : ""}. The portal accepted TapIn's key.` };
}

/** Disconnects the portal: the key is deleted; nothing more is sent. */
export async function removePortalLink(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("settings");
  const db = createAdminClient();
  const { error } = await db.from("portal_links").delete().eq("school_id", user.schoolId);
  if (error) return { errors: { _form: "Could not disconnect. Please try again." } };
  await db.from("portal_deliveries").update({ status: "failed", error: "The portal was disconnected." }).eq("school_id", user.schoolId).eq("status", "pending");
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "portal.remove", entity: "portal_links", entityId: user.schoolId, details: {} });
  revalidatePath("/settings");
  return { ok: "School portal disconnected." };
}
