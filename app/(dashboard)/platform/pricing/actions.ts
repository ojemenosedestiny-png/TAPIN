"use server";

import { revalidatePath, updateTag } from "next/cache";
import { PRICING_TAG } from "@/lib/pricing-data";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, idSchema } from "@/lib/validation";
import type { ActionState } from "@/components/forms/field";

const money = z.coerce.number({ message: "Enter an amount." }).min(0, "Can't be negative.").max(100_000_000, "Too large.");
const optionalId = z.union([idSchema, z.literal("")]).optional().transform((v) => v || null);
const on = (fd: FormData, k: string) => fd.get(k) === "on";

const itemSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, "Give it a name.").max(80),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  unit: z.string().trim().min(1, "e.g. per card").max(30),
  unit_price: money,
});

/** Adds or edits a one-time setup item (kiosk, card, wristband, or anything new). */
export async function saveItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, ...v } = parsed.data;
  const db = createAdminClient();
  const row = { ...v, active: on(fd, "active"), updated_by: user.id, updated_at: new Date().toISOString() };
  let error;
  if (id) ({ error } = await db.from("price_items").update(row).eq("id", id));
  else {
    const { data: last } = await db.from("price_items").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
    ({ error } = await db.from("price_items").insert({ ...row, sort: ((last?.sort as number | undefined) ?? 0) + 1 }));
  }
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  await writeAudit({ schoolId: null, actorId: user.id, action: id ? "pricing.item_edit" : "pricing.item_add", entity: "price_items", entityId: id, details: row });
  revalidatePath("/platform/pricing");
  updateTag(PRICING_TAG); // the public website shows the change straight away
  return { ok: id ? "Saved." : `${v.name} added.` };
}

const planSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, "Give it a name.").max(40),
  min_students: z.coerce.number().int("Whole number.").min(0),
  max_students: z.union([z.literal(""), z.coerce.number().int("Whole number.").min(1)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  monthly_price: money,
  features: z.string().max(2000).optional().transform((v) => (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20)),
  tier: z.enum(["basic", "premium"]),
}).refine((p) => p.max_students === null || p.max_students >= p.min_students, { message: "Must be at least the minimum.", path: ["max_students"] });

/** Adds or edits a monthly plan. Schools on it keep their agreed price; their feature level follows the plan. */
export async function savePlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = planSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, ...v } = parsed.data;
  const db = createAdminClient();
  const row = { ...v, active: on(fd, "active"), updated_by: user.id, updated_at: new Date().toISOString() };
  let error;
  if (id) ({ error } = await db.from("subscription_plans").update(row).eq("id", id));
  else {
    const { data: last } = await db.from("subscription_plans").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
    ({ error } = await db.from("subscription_plans").insert({ ...row, sort: ((last?.sort as number | undefined) ?? 0) + 1 }));
  }
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  if (id) {
    // Premium features follow the plan for every school on it.
    const { data: subs } = await db.from("subscriptions").select("school_id").eq("plan_id", id);
    if (subs?.length) await db.from("schools").update({ plan: v.tier }).in("id", subs.map((s) => s.school_id));
  }
  await writeAudit({ schoolId: null, actorId: user.id, action: id ? "pricing.plan_edit" : "pricing.plan_add", entity: "subscription_plans", entityId: id, details: row });
  revalidatePath("/platform/pricing");
  updateTag(PRICING_TAG); // the public website shows the change straight away
  return { ok: id ? "Saved. Schools on this plan keep their agreed price." : `${v.name} added.` };
}

const moveSchema = z.object({ id: idSchema, table: z.enum(["price_items", "subscription_plans"]), dir: z.enum(["up", "down"]) });

/** Moves an item or plan one place up or down. */
export async function moveRow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireArea("platform");
  const parsed = moveSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid." } };
  const { id, table, dir } = parsed.data;
  const db = createAdminClient();
  const { data: rows } = await db.from(table).select("id, sort").order("sort").order("created_at");
  const list = (rows ?? []) as { id: string; sort: number }[];
  const i = list.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return {};
  [list[i], list[j]] = [list[j]!, list[i]!];
  await Promise.all(list.map((r, k) => (r.sort === k + 1 ? null : db.from(table).update({ sort: k + 1 }).eq("id", r.id))));
  revalidatePath("/platform/pricing");
  updateTag(PRICING_TAG); // the public website shows the change straight away
  return {};
}

const annualSchema = z.object({ annual_free_months: z.coerce.number().int("Whole months.").min(0, "0 to 6.").max(6, "0 to 6.") });

/** Free months when a school pays for a year up front. */
export async function saveAnnualDiscount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireArea("platform");
  const parsed = annualSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const db = createAdminClient();
  const { error } = await db.from("platform_settings").update({ ...parsed.data, pricing_updated_by: user.id }).eq("id", true);
  if (error) return { errors: { _form: "Could not save." } };
  await writeAudit({ schoolId: null, actorId: user.id, action: "pricing.annual", entity: "platform_settings", entityId: null, details: parsed.data });
  revalidatePath("/platform/pricing");
  updateTag(PRICING_TAG); // the public website shows the change straight away
  return { ok: parsed.data.annual_free_months ? `Paying yearly: ${parsed.data.annual_free_months} month${parsed.data.annual_free_months === 1 ? "" : "s"} free.` : "No yearly discount." };
}
