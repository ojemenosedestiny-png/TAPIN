"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, idSchema } from "@/lib/validation";
import { nextRenewal, type Billing } from "@/lib/subscriptions";
import type { ActionState } from "@/components/forms/field";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const schema = z.object({
  school_id: idSchema,
  plan_id: idSchema,
  agreed_monthly_price: z.coerce.number({ message: "Enter an amount." }).min(0, "Can't be negative.").max(100_000_000),
  billing: z.enum(["monthly", "annual"]),
  started_on: isoDate,
  renews_on: z.union([z.literal(""), isoDate]).optional().transform((v) => v || null),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

function refresh() {
  revalidatePath("/platform/subscriptions");
  revalidatePath("/platform");
}

/** Feature level follows the plan: a premium plan unlocks the emergency roll call. */
async function syncTier(db: ReturnType<typeof createAdminClient>, schoolId: string, planId: string) {
  const { data: plan } = await db.from("subscription_plans").select("tier").eq("id", planId).maybeSingle();
  if (plan) await db.from("schools").update({ plan: plan.tier }).eq("id", schoolId);
}

/** Puts a school on a plan, or edits its subscription. The agreed price stays until changed here. */
export async function saveSubscription(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const renews = v.renews_on ?? nextRenewal(v.started_on, v.billing as Billing);
  if (renews < v.started_on) return { errors: { renews_on: "Must be on or after the start date." } };
  const db = createAdminClient();
  const { data: plan } = await db.from("subscription_plans").select("id, name").eq("id", v.plan_id).maybeSingle();
  if (!plan) return { errors: { plan_id: "Choose a plan." } };
  const { data: existing } = await db.from("subscriptions").select("school_id, renews_on").eq("school_id", v.school_id).maybeSingle();
  const row = { ...v, renews_on: renews, updated_by: user.id, updated_at: new Date().toISOString(), ...(existing && existing.renews_on !== renews ? { reminded_for: null } : {}) };
  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "school_id" });
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  await syncTier(db, v.school_id, v.plan_id);
  await writeAudit({ schoolId: v.school_id, actorId: user.id, action: existing ? "subscription.edit" : "subscription.create", entity: "subscriptions", entityId: v.school_id, details: { plan: plan.name, agreed_monthly_price: v.agreed_monthly_price, billing: v.billing, renews_on: renews } });
  refresh();
  return { ok: existing ? "Subscription saved." : `On ${plan.name} until ${renews}.` };
}

const idOnly = z.object({ school_id: idSchema });

/** Payment received: moves the renewal date on by one period (from the old renewal date, so nothing is lost). */
export async function renewSubscription(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = idOnly.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid." } };
  const db = createAdminClient();
  const { data: sub } = await db.from("subscriptions").select("renews_on, billing").eq("school_id", parsed.data.school_id).maybeSingle();
  if (!sub) return { errors: { _form: "This school has no subscription." } };
  const renews = nextRenewal(sub.renews_on as string, sub.billing as Billing);
  const { error } = await db.from("subscriptions").update({ renews_on: renews, suspended: false, reminded_for: null, updated_by: user.id, updated_at: new Date().toISOString() }).eq("school_id", parsed.data.school_id);
  if (error) return { errors: { _form: "Could not renew." } };
  await writeAudit({ schoolId: parsed.data.school_id, actorId: user.id, action: "subscription.renew", entity: "subscriptions", entityId: parsed.data.school_id, details: { from: sub.renews_on, to: renews } });
  refresh();
  return { ok: `Renewed until ${renews}.` };
}

/** Suspend or resume. Suspending only marks the account; it does not stop the school's kiosks. */
export async function toggleSuspend(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = idOnly.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid." } };
  const db = createAdminClient();
  const { data: sub } = await db.from("subscriptions").select("suspended").eq("school_id", parsed.data.school_id).maybeSingle();
  if (!sub) return { errors: { _form: "This school has no subscription." } };
  const suspended = !sub.suspended;
  const { error } = await db.from("subscriptions").update({ suspended, updated_by: user.id, updated_at: new Date().toISOString() }).eq("school_id", parsed.data.school_id);
  if (error) return { errors: { _form: "Could not save." } };
  await writeAudit({ schoolId: parsed.data.school_id, actorId: user.id, action: suspended ? "subscription.suspend" : "subscription.resume", entity: "subscriptions", entityId: parsed.data.school_id, details: {} });
  refresh();
  return { ok: suspended ? "Suspended." : "Resumed." };
}

/** Moves a school from its agreed price to its plan's current price. Only when you choose to. */
export async function moveToCurrentPrice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = idOnly.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid." } };
  const db = createAdminClient();
  const { data: sub } = await db.from("subscriptions").select("agreed_monthly_price, subscription_plans(monthly_price)").eq("school_id", parsed.data.school_id).maybeSingle();
  const current = (sub?.subscription_plans as unknown as { monthly_price: number } | null)?.monthly_price;
  if (!sub || current === undefined) return { errors: { _form: "This school has no subscription." } };
  const { error } = await db.from("subscriptions").update({ agreed_monthly_price: current, updated_by: user.id, updated_at: new Date().toISOString() }).eq("school_id", parsed.data.school_id);
  if (error) return { errors: { _form: "Could not save." } };
  await writeAudit({ schoolId: parsed.data.school_id, actorId: user.id, action: "subscription.reprice", entity: "subscriptions", entityId: parsed.data.school_id, details: { from: Number(sub.agreed_monthly_price), to: Number(current) } });
  refresh();
  return { ok: "Moved to the current price." };
}
